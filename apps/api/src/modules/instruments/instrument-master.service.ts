/**
 * The instrument-master import (plan P6; broker.md operation 5): streams a broker's master through its gateway (never
 * more than once a day, from the 08:00 IST job or an admin trigger) and upserts it in batches of
 * {@link MASTER_BATCH_SIZE}: Instrument rows, and the reverse map InstrumentBrokerToken(broker, token) → key.
 *
 * Idempotent: a re-run upserts the same rows. After a complete run, tokens the run didn't see become inactive, and
 * instruments without any active token become inactive (`isActive = false`, never deleted). A run that saw fewer than
 * {@link MIN_COMPLETE_RATIO} of the broker's active tokens is treated as incomplete and deactivates nothing.
 */
import type { InstrumentRow } from "@finlytics/broker-sdk";
import type { BrokerCode } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import { brokerProblem } from "../brokers/broker-errors";
import { BrokerGateways } from "../brokers/broker-gateways";

import { InstrumentsRepository } from "./instruments.repository";

export const MASTER_BATCH_SIZE = 1_000;
/** A run must see at least this share of the broker's active tokens before anything is deactivated. */
export const MIN_COMPLETE_RATIO = 0.5;

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
  ) {
    logger.setContext(InstrumentMasterService.name);
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
      return { broker, rows, deactivated: 0, skippedDeactivation: true };
    }
    const deactivated = await this.instruments.deactivateMissing(broker, seenAt);
    this.logger.info({ broker, rows, deactivated }, "instrument master synced");
    return { broker, rows, deactivated, skippedDeactivation: false };
  }
}
