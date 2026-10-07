/**
 * The instrument-master import (plan P6; broker.md operation 5): streams a broker's master through its gateway (never
 * more than once a day, from the 08:00 IST job, an admin trigger, a first account activation or a worker start without
 * a sync record) and upserts it in batches of {@link MASTER_BATCH_SIZE}: Instrument rows, and the reverse map
 * InstrumentBrokerToken(broker, token) → key, which the market feed and the candle backfill resolve keys through.
 *
 * Idempotent: a re-run upserts the same rows. After a complete run, tokens the run didn't see become inactive, and
 * instruments without any active token become inactive (`isActive = false`, never deleted). A run that saw fewer than
 * {@link MIN_COMPLETE_RATIO} of the broker's active tokens is treated as incomplete and deactivates nothing.
 *
 * A run that stored rows records `instruments:synced:<BROKER>` (epoch ms, 7 days), logs how many of the feed's pinned
 * keys (indices, NIFTY 50) now have a token (a missing one means the master's keys don't match the canonical ones),
 * and emits `instruments.synced`.
 */
import type { InstrumentRow } from "@finlytics/broker-sdk";
import type { BrokerCode } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import { FEED_EVENTS } from "../../feed/feed-events";
import type { InstrumentsSyncedEvent } from "../../feed/feed-events";
import { PINNED_KEYS } from "../../feed/pinned-keys";
import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import { brokerProblem } from "../brokers/broker-errors";
import { BrokerGateways } from "../brokers/broker-gateways";

import { InstrumentsRepository } from "./instruments.repository";

export const MASTER_BATCH_SIZE = 1_000;
/** A run must see at least this share of the broker's active tokens before anything is deactivated. */
export const MIN_COMPLETE_RATIO = 0.5;
/** How long a sync record lives (a worker start re-syncs a broker without one). */
export const SYNC_RECORD_TTL_S = 7 * 86_400;
/** The pinned keys a sync lists in its log when they have no token. */
const MISSING_LOGGED = 10;

export interface MasterSyncSummary {
  readonly broker: BrokerCode;
  /** Rows upserted. */
  readonly rows: number;
  /** Instruments newly marked inactive. */
  readonly deactivated: number;
  /** True when the run looked incomplete and deactivated nothing. */
  readonly skippedDeactivation: boolean;
}

@Injectable()
export class InstrumentMasterService {
  constructor(
    private readonly gateways: BrokerGateways,
    private readonly instruments: InstrumentsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
    private readonly redis: RedisService,
    private readonly events: EventEmitter2,
  ) {
    logger.setContext(InstrumentMasterService.name);
  }

  /** When `broker`'s master last synced with rows (epoch ms), or null without a record. */
  async lastSyncedAt(broker: BrokerCode): Promise<number | null> {
    const value = await this.redis.client.get(redisKeys.instrumentsSynced(broker));
    return value !== null && /^\d{1,16}$/.test(value) ? Number(value) : null;
  }

  /** The brokers with an instrument master to sync: every registered broker but the paper broker. */
  syncableBrokers(): BrokerCode[] {
    return this.gateways.codes().filter((code) => code !== "PAPER");
  }

  async sync(broker: BrokerCode, signal?: AbortSignal): Promise<MasterSyncSummary> {
    const gateway = this.gateways.gateway(broker);
    const seenAt = this.clock.now();
    const activeBefore = await this.instruments.activeTokenCount(broker);
    let rows = 0;
    let batch = new Map<string, InstrumentRow>();
    const tokens = new Set<string>();
    const flush = async (): Promise<void> => {
      if (batch.size === 0) return;
      const values = [...batch.values()];
      batch = new Map();
      tokens.clear();
      await this.instruments.upsertBatch(broker, values, seenAt);
      rows += values.length;
    };
    try {
      for await (const row of gateway.downloadInstrumentMaster({ signal })) {
        // One statement can't touch a row twice: keep the last row per key, and the first per token.
        if (tokens.has(row.brokerToken) && !batch.has(row.instrumentKey)) continue;
        batch.set(row.instrumentKey, row);
        tokens.add(row.brokerToken);
        if (batch.size >= MASTER_BATCH_SIZE) await flush();
      }
      await flush();
    } catch (error: unknown) {
      throw brokerProblem(error, "call");
    }
    if (rows === 0 || rows < activeBefore * MIN_COMPLETE_RATIO) {
      this.logger.warn({ broker, rows, activeBefore }, "instrument master looks incomplete; nothing deactivated");
      if (rows > 0) await this.recorded(broker, rows, 0);
      return { broker, rows, deactivated: 0, skippedDeactivation: true };
    }
    const deactivated = await this.instruments.deactivateMissing(broker, seenAt);
    await this.recorded(broker, rows, deactivated);
    return { broker, rows, deactivated, skippedDeactivation: false };
  }

  /** Records the sync, logs its counts with the pinned keys' coverage, and tells the feed. Never throws. */
  private async recorded(broker: BrokerCode, rows: number, deactivated: number): Promise<void> {
    let pinned: number | undefined;
    let missingPinned: string[] = [];
    try {
      const covered = await this.instruments.coveredKeys(broker, PINNED_KEYS);
      pinned = covered.size;
      missingPinned = PINNED_KEYS.filter((key) => !covered.has(key));
      await this.redis.client.set(
        redisKeys.instrumentsSynced(broker),
        String(this.clock.now().getTime()),
        "EX",
        SYNC_RECORD_TTL_S,
      );
    } catch (error: unknown) {
      this.logger.warn({ err: error, broker }, "could not record the instrument master sync");
    }
    const log = {
      broker,
      rows,
      deactivated,
      pinned: `${String(pinned ?? "?")}/${String(PINNED_KEYS.length)}`,
      missingPinned: missingPinned.slice(0, MISSING_LOGGED),
    };
    if (missingPinned.length > 0) this.logger.warn(log, "instrument master synced; some pinned keys have no token");
    else this.logger.info(log, "instrument master synced");
    try {
      this.events.emit(FEED_EVENTS.instrumentsSynced, { broker, rows } satisfies InstrumentsSyncedEvent);
    } catch (error: unknown) {
      this.logger.warn({ err: error, broker }, "an instruments.synced listener failed");
    }
  }
}
