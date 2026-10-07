/**
 * Which source should drive the platform feed (phase-1b "Feed source"), by MARKET_FEED_SOURCE:
 *
 * - `paper`: the simulator.
 * - `upstox` / `dhan`: the account in MARKET_FEED_ACCOUNT_ID, always (production). A failing account is retried with a
 *   short backoff; the feed never falls back to simulated prices.
 * - `auto` (development): MARKET_FEED_ACCOUNT_ID if ACTIVE → the ACTIVE Upstox account with the latest login → the
 *   latest ACTIVE Dhan account → the simulator. An account whose feed failed (refused token, no connection) waits out a
 *   growing backoff; a broker without a synced instrument master is skipped. The fallback carries a `reason` in our own
 *   words.
 *
 * The engine asks again every 30 s and on `broker.account.*` events.
 */
import { isBrokerError } from "@finlytics/broker-sdk";

import type { MarketFeedSource } from "../config/env.schema";

import { BROKER_NAMES, PAPER_TARGET } from "./feed-source";
import type { FeedTarget, LiveFeedBroker } from "./feed-source";

/** An ACTIVE broker account that could drive the feed. */
export interface FeedAccountCandidate {
  readonly accountId: string;
  readonly broker: LiveFeedBroker;
}

/** Account and instrument lookups across users (development's `auto` only reads ids and brokers). */
export interface FeedAccountDirectory {
  /** The account when it is ACTIVE and an Upstox or Dhan account, else null. */
  active(accountId: string): Promise<FeedAccountCandidate | null>;
  /** ACTIVE Upstox accounts, then ACTIVE Dhan accounts, each latest login first, at most `limit` of each. */
  candidates(limit: number): Promise<FeedAccountCandidate[]>;
  /** Whether `broker`'s instrument master was synced (it has active instrument tokens). */
  hasInstruments(broker: LiveFeedBroker): Promise<boolean>;
  /**
   * The broker of the latest Upstox or Dhan account that only needs a new broker login (NEEDS_RELOGIN or EXPIRED:
   * Upstox sessions end at 03:30 IST every day), or null. Optional: without it the reason stays generic.
   */
  lapsed?(): Promise<LiveFeedBroker | null>;
}

export interface FeedDecision {
  readonly target: FeedTarget;
  /** Why the feed isn't on a broker (auto's fallback), or null. */
  readonly reason: string | null;
}

interface Failure {
  readonly count: number;
  readonly retryAt: number;
  readonly reason: string;
}

/** Candidates per broker considered by `auto`. */
const CANDIDATES_PER_BROKER = 3;

/** The wait before retrying a failed account: auto falls back to paper meanwhile, so it waits longer. */
export function failureBackoffMs(mode: MarketFeedSource, failures: number): number {
  const [base, max] = mode === "auto" ? [30_000, 600_000] : [2_000, 60_000];
  return Math.min(max, base * 2 ** Math.min(Math.max(failures - 1, 0), 20));
}

/** Our own words for a broker feed that failed to start (never the broker's message). */
export function connectFailureReason(broker: LiveFeedBroker, error: unknown): string {
  const name = BROKER_NAMES[broker] ?? broker;
  if (isBrokerError(error) && error.code === "NEEDS_RELOGIN") {
    return broker === "DHAN"
      ? "The Dhan access token was refused: renew it for live prices"
      : `The ${name} session has ended: log in again for live prices`;
  }
  if (isBrokerError(error) && error.code === "BROKER_REJECTED") {
    return `${name} refused the market feed for this account (is its data plan active?)`;
  }
  return `Can't reach the ${name} market feed; retrying`;
}

export function lostFeedReason(broker: LiveFeedBroker): string {
  return `Lost the ${BROKER_NAMES[broker] ?? broker} market feed; retrying`;
}

export const NO_ACCOUNT_REASON = "No Upstox or Dhan account is connected";

/** Auto's reason when the only live-broker accounts need a new login. */
export function lapsedSessionReason(broker: LiveFeedBroker): string {
  return `The ${BROKER_NAMES[broker] ?? broker} session has ended: log in again on Brokers for live prices`;
}

export function noInstrumentsReason(broker: LiveFeedBroker): string {
  return `The ${BROKER_NAMES[broker] ?? broker} instrument list hasn't been downloaded yet`;
}

export class FeedSourceSelector {
  readonly #failures = new Map<string, Failure>();

  constructor(
    readonly mode: MarketFeedSource,
    private readonly configuredAccountId: string | undefined,
    private readonly directory: FeedAccountDirectory,
    private readonly now: () => number = Date.now,
  ) {}

  /** The source that should drive the feed now. */
  async select(): Promise<FeedDecision> {
    switch (this.mode) {
      case "paper":
        return { target: PAPER_TARGET, reason: null };
      case "upstox":
      case "dhan":
        return {
          target: { broker: this.mode === "upstox" ? "UPSTOX" : "DHAN", accountId: this.configuredAccountId ?? "" },
          reason: null,
        };
      case "auto":
        return this.#auto();
    }
  }

  /** When a failed account may be tried again (epoch ms), or undefined when it isn't waiting. */
  blockedUntil(target: FeedTarget): number | undefined {
    if (target.broker === "PAPER") return undefined;
    const failure = this.#failures.get(target.accountId);
    return failure !== undefined && failure.retryAt > this.now() ? failure.retryAt : undefined;
  }

  /** The reason of an account's last failure, while it waits. */
  failureReason(target: FeedTarget): string | undefined {
    return target.broker === "PAPER" ? undefined : this.#failures.get(target.accountId)?.reason;
  }

  recordFailure(target: FeedTarget, reason: string): void {
    if (target.broker === "PAPER") return;
    const count = (this.#failures.get(target.accountId)?.count ?? 0) + 1;
    this.#failures.set(target.accountId, {
      count,
      retryAt: this.now() + failureBackoffMs(this.mode, count),
      reason,
    });
  }

  recordSuccess(target: FeedTarget): void {
    if (target.broker !== "PAPER") this.#failures.delete(target.accountId);
  }

  async #auto(): Promise<FeedDecision> {
    const candidates: FeedAccountCandidate[] = [];
    if (this.configuredAccountId !== undefined) {
      const configured = await this.directory.active(this.configuredAccountId);
      if (configured !== null) candidates.push(configured);
    }
    for (const candidate of await this.directory.candidates(CANDIDATES_PER_BROKER)) {
      if (!candidates.some((existing) => existing.accountId === candidate.accountId)) candidates.push(candidate);
    }
    let reason: string | null = null;
    if (candidates.length === 0) {
      const lapsed = (await this.directory.lapsed?.()) ?? null;
      reason = lapsed === null ? NO_ACCOUNT_REASON : lapsedSessionReason(lapsed);
    }
    const now = this.now();
    const instruments = new Map<LiveFeedBroker, boolean>();
    for (const candidate of candidates) {
      const failure = this.#failures.get(candidate.accountId);
      if (failure !== undefined && failure.retryAt > now) {
        reason ??= failure.reason;
        continue;
      }
      let synced = instruments.get(candidate.broker);
      if (synced === undefined) {
        synced = await this.directory.hasInstruments(candidate.broker);
        instruments.set(candidate.broker, synced);
      }
      if (!synced) {
        reason ??= noInstrumentsReason(candidate.broker);
        continue;
      }
      return { target: { broker: candidate.broker, accountId: candidate.accountId }, reason: null };
    }
    return { target: PAPER_TARGET, reason };
  }
}
