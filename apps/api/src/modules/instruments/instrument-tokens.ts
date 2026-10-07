/**
 * Canonical key ↔ broker token lookups over `InstrumentBrokerToken` (filled by the instrument-master sync, plan P6),
 * for the code that streams or backfills market data through a broker: the feed maps its wanted keys to the current
 * broker's tokens (keys without a token are skipped: no quote, the UI shows "—"), and the adapters resolve instruments
 * through {@link DbUpstoxInstrumentResolver} (Upstox) or a `DhanInstrumentMap` loaded from here (Dhan).
 *
 * Reference data, no owner. Lookups are cached in memory: found tokens for 10 minutes, misses for 1 minute (so a key
 * appears soon after a sync adds it).
 */
import type { UpstoxInstrumentRef, UpstoxInstrumentResolver } from "@finlytics/broker-sdk";
import { isInstrumentKey } from "@finlytics/shared";
import type { BrokerCode, InstrumentKey } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";

import { trimDecimal } from "./instrument.mapper";

/** One instrument's token at a broker, with the order checks adapters use. */
export interface InstrumentTokenRef {
  readonly instrumentKey: InstrumentKey;
  readonly brokerToken: string;
  readonly lotSize: number;
  readonly tickSize: string;
  readonly freezeQty: number | undefined;
}

/** The database reads behind {@link InstrumentTokens} (a fake in unit tests). */
export interface InstrumentTokenStore {
  /** Active tokens of `broker` for `keys`, the most recently seen first when a key has several. */
  byKeys(broker: BrokerCode, keys: readonly InstrumentKey[]): Promise<InstrumentTokenRef[]>;
  /** Active keys of `broker`'s `tokens`. */
  byTokens(broker: BrokerCode, tokens: readonly string[]): Promise<{ token: string; instrumentKey: string }[]>;
  /** Whether `broker` has any active token (an instrument master was synced). */
  hasAny(broker: BrokerCode): Promise<boolean>;
}

const FOUND_TTL_MS = 600_000;
const MISSING_TTL_MS = 60_000;
const HAS_ANY_TTL_MS = 30_000;
const MAX_ENTRIES = 100_000;
/** Keys or tokens per query. */
const QUERY_CHUNK = 1_000;

interface Entry<T> {
  readonly value: T | null;
  readonly until: number;
}

/** A bounded TTL cache: cleared when it grows past {@link MAX_ENTRIES} (rare; lookups refill it). */
class TtlCache<T> {
  readonly #entries = new Map<string, Entry<T>>();

  get(key: string, now: number): Entry<T> | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.until <= now) return undefined;
    return entry;
  }

  set(key: string, value: T | null, until: number): void {
    if (this.#entries.size >= MAX_ENTRIES) this.#entries.clear();
    this.#entries.set(key, { value, until });
  }

  clear(): void {
    this.#entries.clear();
  }
}

export class InstrumentTokenCache {
  readonly #byKey = new TtlCache<InstrumentTokenRef>();
  readonly #byToken = new TtlCache<InstrumentKey>();
  readonly #hasAny = new Map<string, { value: boolean; until: number }>();

  constructor(
    private readonly store: InstrumentTokenStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** The tokens of `keys` at `broker`; keys without one are absent. */
  async tokensFor(broker: BrokerCode, keys: readonly InstrumentKey[]): Promise<Map<InstrumentKey, InstrumentTokenRef>> {
    const now = this.now();
    const found = new Map<InstrumentKey, InstrumentTokenRef>();
    const unknown: InstrumentKey[] = [];
    for (const key of new Set(keys)) {
      const entry = this.#byKey.get(`${broker}|${key}`, now);
      if (entry === undefined) unknown.push(key);
      else if (entry.value !== null) found.set(key, entry.value);
    }
    for (let index = 0; index < unknown.length; index += QUERY_CHUNK) {
      const chunk = unknown.slice(index, index + QUERY_CHUNK);
      const rows = await this.store.byKeys(broker, chunk);
      const first = new Map<InstrumentKey, InstrumentTokenRef>();
      for (const row of rows) if (!first.has(row.instrumentKey)) first.set(row.instrumentKey, row);
      for (const key of chunk) {
        const row = first.get(key);
        this.#byKey.set(`${broker}|${key}`, row ?? null, now + (row === undefined ? MISSING_TTL_MS : FOUND_TTL_MS));
        if (row !== undefined) {
          found.set(key, row);
          this.#byToken.set(`${broker}|${row.brokerToken}`, key, now + FOUND_TTL_MS);
        }
      }
    }
    return found;
  }

  /** The canonical keys of `tokens` at `broker`; unknown tokens are absent. */
  async keysFor(broker: BrokerCode, tokens: readonly string[]): Promise<Map<string, InstrumentKey>> {
    const now = this.now();
    const found = new Map<string, InstrumentKey>();
    const unknown: string[] = [];
    for (const token of new Set(tokens)) {
      const entry = this.#byToken.get(`${broker}|${token}`, now);
      if (entry === undefined) unknown.push(token);
      else if (entry.value !== null) found.set(token, entry.value);
    }
    for (let index = 0; index < unknown.length; index += QUERY_CHUNK) {
      const chunk = unknown.slice(index, index + QUERY_CHUNK);
      const rows = new Map(
        (await this.store.byTokens(broker, chunk))
          .filter((row): row is { token: string; instrumentKey: InstrumentKey } => isInstrumentKey(row.instrumentKey))
          .map((row) => [row.token, row.instrumentKey]),
      );
      for (const token of chunk) {
        const key = rows.get(token);
        this.#byToken.set(`${broker}|${token}`, key ?? null, now + (key === undefined ? MISSING_TTL_MS : FOUND_TTL_MS));
        if (key !== undefined) found.set(token, key);
      }
    }
    return found;
  }

  /** Whether `broker` has any instrument token at all (cached 30 s). */
  async hasAny(broker: BrokerCode): Promise<boolean> {
    const now = this.now();
    const cached = this.#hasAny.get(broker);
    if (cached !== undefined && cached.until > now) return cached.value;
    const value = await this.store.hasAny(broker);
    this.#hasAny.set(broker, { value, until: now + HAS_ANY_TTL_MS });
    return value;
  }

  /** Forgets everything (after a sync changed the tokens). */
  clear(): void {
    this.#byKey.clear();
    this.#byToken.clear();
    this.#hasAny.clear();
  }
}

/** An {@link UpstoxInstrumentResolver} over the cache, so Upstox calls resolve canonical keys from our table. */
export class DbUpstoxInstrumentResolver implements UpstoxInstrumentResolver {
  constructor(private readonly tokens: Pick<InstrumentTokenCache, "tokensFor" | "keysFor">) {}

  async byKeys(keys: readonly InstrumentKey[]): Promise<ReadonlyMap<InstrumentKey, UpstoxInstrumentRef>> {
    const found = await this.tokens.tokensFor("UPSTOX", keys);
    return new Map(
      [...found].map(([key, ref]) => [
        key,
        {
          instrumentKey: key,
          brokerToken: ref.brokerToken,
          lotSize: ref.lotSize,
          tickSize: ref.tickSize,
          freezeQty: ref.freezeQty,
        },
      ]),
    );
  }

  byTokens(tokens: readonly string[]): Promise<ReadonlyMap<string, InstrumentKey>> {
    return this.tokens.keysFor("UPSTOX", tokens);
  }
}

/** {@link InstrumentTokenStore} on PostgreSQL (indexes: `(instrumentKey, broker)` and the `(broker, token)` key). */
@Injectable()
export class InstrumentTokensRepository implements InstrumentTokenStore {
  constructor(private readonly prisma: PrismaService) {}

  async byKeys(broker: BrokerCode, keys: readonly InstrumentKey[]): Promise<InstrumentTokenRef[]> {
    if (keys.length === 0) return [];
    const rows = await this.prisma.db.instrumentBrokerToken.findMany({
      where: { broker, isActive: true, instrumentKey: { in: [...keys] } },
      orderBy: { seenAt: "desc" },
      select: {
        instrumentKey: true,
        token: true,
        instrument: { select: { lotSize: true, tickSize: true, freezeQty: true } },
      },
    });
    return rows
      .filter((row) => isInstrumentKey(row.instrumentKey))
      .map((row) => ({
        instrumentKey: row.instrumentKey as InstrumentKey,
        brokerToken: row.token,
        lotSize: row.instrument.lotSize,
        tickSize: trimDecimal(row.instrument.tickSize.toFixed()),
        freezeQty: row.instrument.freezeQty ?? undefined,
      }));
  }

  async byTokens(broker: BrokerCode, tokens: readonly string[]): Promise<{ token: string; instrumentKey: string }[]> {
    if (tokens.length === 0) return [];
    return this.prisma.db.instrumentBrokerToken.findMany({
      where: { broker, isActive: true, token: { in: [...tokens] } },
      select: { token: true, instrumentKey: true },
    });
  }

  async hasAny(broker: BrokerCode): Promise<boolean> {
    const row = await this.prisma.db.instrumentBrokerToken.findFirst({
      where: { broker, isActive: true },
      select: { token: true },
    });
    return row !== null;
  }
}
