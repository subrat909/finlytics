/**
 * On worker start (phase-1b "Instrument master"): queues `instrument-master-sync` for every broker that has an ACTIVE
 * account but no sync record (`instruments:synced:<BROKER>`), so an account connected before the instrument master
 * ever ran (or whose record expired) gets live data without waiting for 08:00 IST. Job ids are per broker and hour,
 * so several workers starting together queue one job. Runs in the background: a slow Redis never blocks the boot.
 *
 * Which brokers have an ACTIVE account spans users: raw SQL reading broker codes only (index: `(status, …)`).
 */
import { BrokerCodeSchema } from "@finlytics/shared";
import type { BrokerCode } from "@finlytics/shared";
import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import type { Queue } from "bullmq";
import { PinoLogger } from "nestjs-pino";

import { CLOCK } from "../common/clock";
import type { Clock } from "../common/clock";
import { PrismaService } from "../infra/prisma/prisma.service";
import { QUEUE_NAMES } from "../infra/queue/queue-names";
import { InstrumentMasterService } from "../modules/instruments/instrument-master.service";
import { queueMasterSync } from "../modules/instruments/instruments.service";
import type { InstrumentSyncJobData } from "../modules/instruments/instruments.service";

/** The brokers with at least one ACTIVE account. */
export interface ActiveBrokerSource {
  activeBrokers(): Promise<BrokerCode[]>;
}

@Injectable()
export class InstrumentMasterSyncStartup implements OnApplicationBootstrap, ActiveBrokerSource {
  constructor(
    private readonly prisma: PrismaService,
    private readonly master: InstrumentMasterService,
    @InjectQueue(QUEUE_NAMES.instrumentMasterSync) private readonly queue: Queue<InstrumentSyncJobData>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(InstrumentMasterSyncStartup.name);
  }

  onApplicationBootstrap(): void {
    void this.run().catch((error: unknown) => {
      this.logger.warn({ err: error }, "could not check the instrument masters on start");
    });
  }

  /** Queues the missing syncs; returns the brokers queued. */
  async run(source: ActiveBrokerSource = this): Promise<BrokerCode[]> {
    const syncable = new Set(this.master.syncableBrokers());
    const queued: BrokerCode[] = [];
    for (const broker of await source.activeBrokers()) {
      if (!syncable.has(broker) || (await this.master.lastSyncedAt(broker)) !== null) continue;
      const jobId = await queueMasterSync(this.queue, broker, "startup", this.clock.now());
      queued.push(broker);
      this.logger.info({ broker, jobId }, "queued the instrument master: an active account has none synced");
    }
    return queued;
  }

  async activeBrokers(): Promise<BrokerCode[]> {
    const rows = await this.prisma.db.$queryRaw<{ broker: string }[]>`
      SELECT DISTINCT "broker"::text AS "broker" FROM "BrokerAccount" WHERE "status" = 'ACTIVE'`;
    return rows.flatMap((row) => {
      const broker = BrokerCodeSchema.safeParse(row.broker);
      return broker.success ? [broker.data] : [];
    });
  }
}
