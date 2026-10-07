/**
 * Registers the repeating jobs (BullMQ job schedulers, idempotent by id) when a worker starts: the instrument master at
 * 08:00 IST, the broker-token check at 08:30 IST and the Dhan token renewal every 30 minutes. Runs in the background so
 * a slow Redis never blocks the boot.
 */
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import type { Queue } from "bullmq";
import { PinoLogger } from "nestjs-pino";

import { JOB_SCHEDULES, QUEUE_NAMES } from "../infra/queue/queue-names";

@Injectable()
export class JobSchedulerService implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.instrumentMasterSync) private readonly syncQueue: Queue,
    @InjectQueue(QUEUE_NAMES.brokerTokenExpiry) private readonly expiryQueue: Queue,
    @InjectQueue(QUEUE_NAMES.brokerTokenRenew) private readonly renewQueue: Queue,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(JobSchedulerService.name);
  }

  onApplicationBootstrap(): void {
    void this.schedule().catch((error: unknown) => {
      this.logger.error({ err: error }, "job schedules not registered");
    });
  }

  async schedule(): Promise<void> {
    const { instrumentMasterSync: sync, brokerTokenExpiry: expiry, brokerTokenRenew: renew } = JOB_SCHEDULES;
    await this.syncQueue.upsertJobScheduler(
      sync.id,
      { pattern: sync.pattern, tz: sync.tz },
      { name: "sync", data: {} },
    );
    await this.expiryQueue.upsertJobScheduler(
      expiry.id,
      { pattern: expiry.pattern, tz: expiry.tz },
      { name: "check", data: {} },
    );
    await this.renewQueue.upsertJobScheduler(
      renew.id,
      { pattern: renew.pattern, tz: renew.tz },
      { name: "renew", data: {} },
    );
  }
}
