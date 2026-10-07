/**
 * Instrument maps for the adapters BrokerGateways builds (phase 1b): our canonical keys ↔ each broker's own instrument
 * ids, from the `InstrumentBrokerToken` reverse map the instrument-master sync fills. Without them Dhan can't name any
 * instrument (subscriptions, orders, positions) and Upstox only maps equity positions and holdings.
 *
 * - Upstox: an async {@link UpstoxInstrumentResolver} over the table (looked up on demand, found entries cached).
 * - Dhan: one synchronous `DhanInstrumentMap` (tokens `<exchangeSegment>:<securityId>`), loaded once per process on
 *   first use ({@link BrokerInstrumentMaps.prepare}, awaited by BrokerAccessService before it hands out an account).
 * - `instruments.synced` `{broker}` (the instrument-master import) reloads Dhan's map and clears Upstox's cache.
 * Reference data only: no user rows, no credentials.
 */
import { DhanInstrumentMap } from "@finlytics/broker-sdk";
import type { BrokerLogger, UpstoxInstrumentRef, UpstoxInstrumentResolver } from "@finlytics/broker-sdk";
import { BrokerCodeSchema, isInstrumentKey } from "@finlytics/shared";
import type { BrokerCode, InstrumentKey } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { PrismaService } from "../../infra/prisma/prisma.service";

/** Emitted by the instrument-master import after a sync stored rows (`{broker, rows}`). */
export const INSTRUMENTS_SYNCED_EVENT = "instruments.synced";

/** The part of the event this module reads; anything else in the payload is ignored. */
export const InstrumentsSyncedSchema = z.object({ broker: BrokerCodeSchema });

/** One `(instrumentKey, brokerToken)` pair of the reverse map. */
export interface BrokerTokenRow {
  readonly instrumentKey: string;
  readonly brokerToken: string;
}

/** The reads behind the maps (a fake in unit tests). */
export interface BrokerInstrumentSource {
  /** Every active token of `broker`, in pages of `pageSize`, ascending by token. */
  tokens(broker: BrokerCode, afterToken: string, pageSize: number): Promise<BrokerTokenRow[]>;
  /** Active Upstox-style refs (with the order checks) for canonical keys; unknown keys are absent. */
  refsByKeys(broker: BrokerCode, keys: readonly InstrumentKey[]): Promise<UpstoxInstrumentRef[]>;
  /** Active canonical keys for broker tokens; unknown tokens are absent. */
  keysByTokens(broker: BrokerCode, tokens: readonly string[]): Promise<BrokerTokenRow[]>;
}

/** No instrument data (unit tests, a process without a database): adapters fall back to what rows carry. */
export const NO_INSTRUMENT_SOURCE: BrokerInstrumentSource = Object.freeze({
  tokens: () => Promise.resolve([]),
  refsByKeys: () => Promise.resolve([]),
  keysByTokens: () => Promise.resolve([]),
});

/** Rows per page when loading a whole map. */
export const TOKEN_PAGE_SIZE = 10_000;

/** The most cached Upstox lookups before the cache starts over (lookups refill it). */
const MAX_CACHED = 200_000;

/** The trimmed decimal text of a Prisma Decimal: `"0.0500"` → `"0.05"`. */
function decimalText(value: { toFixed(): string }): string {
  const text = value.toFixed();
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** {@link BrokerInstrumentSource} on PostgreSQL (`InstrumentBrokerToken`: key `(broker, token)`, `(instrumentKey, broker)`). */
@Injectable()
export class BrokerInstrumentsRepository implements BrokerInstrumentSource {
  constructor(private readonly prisma: PrismaService) {}

  async tokens(broker: BrokerCode, afterToken: string, pageSize: number): Promise<BrokerTokenRow[]> {
    const rows = await this.prisma.db.instrumentBrokerToken.findMany({
      where: { broker, isActive: true, token: { gt: afterToken } },
      orderBy: { token: "asc" },
      take: pageSize,
      select: { token: true, instrumentKey: true },
    });
    return rows.map((row) => ({ instrumentKey: row.instrumentKey, brokerToken: row.token }));
  }

  async refsByKeys(broker: BrokerCode, keys: readonly InstrumentKey[]): Promise<UpstoxInstrumentRef[]> {
    if (keys.length === 0) return [];
    const rows = await this.prisma.db.instrumentBrokerToken.findMany({
      where: { broker, isActive: true, instrumentKey: { in: [...keys] } },
      orderBy: { seenAt: "desc" },
      select: {
        token: true,
        instrumentKey: true,
        instrument: { select: { lotSize: true, tickSize: true, freezeQty: true } },
      },
    });
    return rows.flatMap((row) =>
      isInstrumentKey(row.instrumentKey)
        ? [
            {
              instrumentKey: row.instrumentKey,
              brokerToken: row.token,
              lotSize: row.instrument.lotSize,
              tickSize: decimalText(row.instrument.tickSize),
              freezeQty: row.instrument.freezeQty ?? undefined,
            },
          ]
        : [],
    );
  }

  async keysByTokens(broker: BrokerCode, tokens: readonly string[]): Promise<BrokerTokenRow[]> {
    if (tokens.length === 0) return [];
    const rows = await this.prisma.db.instrumentBrokerToken.findMany({
      where: { broker, isActive: true, token: { in: [...tokens] } },
      select: { token: true, instrumentKey: true },
    });
    return rows.map((row) => ({ instrumentKey: row.instrumentKey, brokerToken: row.token }));
  }
}

/** The maps of one process (BrokerGateways owns one). */
export class BrokerInstrumentMaps {
  /** Dhan's map, shared by every Dhan adapter of the process; filled by {@link prepare}. */
  readonly dhan = new DhanInstrumentMap();
  /** Upstox's resolver over the table. */
  readonly upstox: UpstoxInstrumentResolver;
  #dhanLoad: Promise<void> | undefined;
  readonly #byKey = new Map<InstrumentKey, UpstoxInstrumentRef>();
  readonly #byToken = new Map<string, InstrumentKey>();

  constructor(
    private readonly source: BrokerInstrumentSource,
    private readonly logger: BrokerLogger,
  ) {
    this.upstox = {
      byKeys: (keys) => this.#upstoxByKeys(keys),
      byTokens: (tokens) => this.#upstoxByTokens(tokens),
    };
  }

  /**
   * Makes `broker`'s synchronous map ready: Dhan's is loaded on first use, and later calls wait for that one load. A
   * failed load is logged and retried by the next call (the adapter falls back to what the rows themselves carry).
   */
  prepare(broker: BrokerCode): Promise<void> {
    if (broker !== "DHAN") return Promise.resolve();
    this.#dhanLoad ??= this.#loadDhan();
    return this.#dhanLoad;
  }

  /** After an instrument-master sync of `broker`: Dhan's map is loaded again, Upstox's lookups are forgotten. */
  async reload(broker: BrokerCode): Promise<void> {
    if (broker === "UPSTOX") {
      this.#byKey.clear();
      this.#byToken.clear();
      return;
    }
    if (broker !== "DHAN") return;
    this.#dhanLoad = this.#loadDhan();
    await this.#dhanLoad;
  }

  async #loadDhan(): Promise<void> {
    try {
      let after = "";
      let loaded = 0;
      for (;;) {
        const page = await this.source.tokens("DHAN", after, TOKEN_PAGE_SIZE);
        loaded += this.dhan.load(page);
        const last = page.at(-1);
        if (last === undefined || page.length < TOKEN_PAGE_SIZE) break;
        after = last.brokerToken;
      }
      this.logger.debug({ broker: "DHAN", loaded }, "broker instrument map loaded");
    } catch (error: unknown) {
      this.#dhanLoad = undefined;
      this.logger.warn({ broker: "DHAN", err: error }, "broker instrument map not loaded");
    }
  }

  async #upstoxByKeys(keys: readonly InstrumentKey[]): Promise<ReadonlyMap<InstrumentKey, UpstoxInstrumentRef>> {
    const found = new Map<InstrumentKey, UpstoxInstrumentRef>();
    const unknown: InstrumentKey[] = [];
    for (const key of new Set(keys)) {
      const ref = this.#byKey.get(key);
      if (ref === undefined) unknown.push(key);
      else found.set(key, ref);
    }
    if (unknown.length > 0) {
      this.#bound();
      for (const ref of await this.source.refsByKeys("UPSTOX", unknown)) {
        if (found.has(ref.instrumentKey)) continue; // the most recently seen token wins
        found.set(ref.instrumentKey, ref);
        this.#byKey.set(ref.instrumentKey, ref);
        this.#byToken.set(ref.brokerToken, ref.instrumentKey);
      }
    }
    return found;
  }

  async #upstoxByTokens(tokens: readonly string[]): Promise<ReadonlyMap<string, InstrumentKey>> {
    const found = new Map<string, InstrumentKey>();
    const unknown: string[] = [];
    for (const token of new Set(tokens)) {
      const key = this.#byToken.get(token);
      if (key === undefined) unknown.push(token);
      else found.set(token, key);
    }
    if (unknown.length > 0) {
      this.#bound();
      for (const row of await this.source.keysByTokens("UPSTOX", unknown)) {
        if (!isInstrumentKey(row.instrumentKey)) continue;
        found.set(row.brokerToken, row.instrumentKey);
        this.#byToken.set(row.brokerToken, row.instrumentKey);
      }
    }
    return found;
  }

  #bound(): void {
    if (this.#byKey.size + this.#byToken.size < MAX_CACHED) return;
    this.#byKey.clear();
    this.#byToken.clear();
  }
}
