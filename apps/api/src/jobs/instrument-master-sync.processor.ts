import { BrokerCodeSchema } from "@finlytics/shared";
import type { BrokerCode } from "@finlytics/shared";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { QUEUE_NAMES } from "../infra/queue/queue-names";
import { InstrumentMasterService } from "../modules/instruments/instrument-master.service";
import type { MasterSyncSummary } from "../modules/instruments/instrument-master.service";

/** The job payload: one broker, or every syncable broker (the daily schedule's `{}`). */
export const InstrumentSyncJobSchema = z.strictObject({
  broker: BrokerCodeSchema.optional(),
  requestedBy: z.string().min(1).max(64).optional(),
});

/**
 * `instrument-master-sync` (daily 08:00 IST and on demand). Brokers are synced one after another; one broker's failure
 * doesn't stop the others, and the job then fails so BullMQ retries it (re-running is safe: upserts).
 */
@Processor(QUEUE_NAMES.instrumentMasterSync)
export class InstrumentMasterSyncProcessor extends WorkerHost {
  constructor(
    private readonly master: InstrumentMasterService,
    private readonly logger: PinoLogger,
  ) {
    super();
    logger.setContext(InstrumentMasterSyncProcessor.name);
  }

  async process(job: Pick<Job, "id" | "data">): Promise<MasterSyncSummary[]> {
    const data = InstrumentSyncJobSchema.parse(job.data);
    const brokers: BrokerCode[] = data.broker === undefined ? this.master.syncableBrokers() : [data.broker];
    const summaries: MasterSyncSummary[] = [];
    const failed: BrokerCode[] = [];
    for (const broker of brokers) {
      try {
        summaries.push(await this.master.sync(broker));
      } catch (error: unknown) {
        failed.push(broker);
        this.logger.error({ err: error, broker, jobId: job.id }, "instrument master sync failed");
      }
    }
    if (failed.length > 0) throw new Error(`Instrument master sync failed for ${failed.join(", ")}`);
    return summaries;
  }
}
