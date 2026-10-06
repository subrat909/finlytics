import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../../config/env.schema";

import { queueConnectionOptions } from "./queue-connection";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from "./queue-names";

/**
 * The BullMQ connection (on the existing Redis, REDIS_URL) and the queues. Producers (`@InjectQueue(name)`) work in any
 * process role; processors run only where jobs/WorkerModule is imported (`worker` role). A static module, so importing
 * it from several modules (or the http and worker graphs of one process) shares one set of queues.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: queueConnectionOptions(config.get("REDIS_URL", { infer: true })),
        prefix: "bull",
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.instrumentMasterSync }, { name: QUEUE_NAMES.brokerTokenExpiry }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
