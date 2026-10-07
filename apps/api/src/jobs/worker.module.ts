import { Module } from "@nestjs/common";

import { CLOCK, systemClock } from "../common/clock";
import { QueueModule } from "../infra/queue/queue.module";
import { AuditModule } from "../modules/audit/audit.module";
import { BrokersModule } from "../modules/brokers/brokers.module";
import { InstrumentsModule } from "../modules/instruments/instruments.module";

import { BrokerTokenExpiryProcessor } from "./broker-token-expiry.processor";
import { BrokerTokenExpiryRepository } from "./broker-token-expiry.repository";
import { BrokerTokenExpiryService } from "./broker-token-expiry.service";
import { BrokerTokenRenewProcessor } from "./broker-token-renew.processor";
import { BrokerTokenRenewRepository } from "./broker-token-renew.repository";
import { BrokerTokenRenewService } from "./broker-token-renew.service";
import { InstrumentMasterSyncProcessor } from "./instrument-master-sync.processor";
import { InstrumentMasterSyncStartup } from "./instrument-master-sync.startup";
import { JobSchedulerService } from "./job-scheduler.service";

/**
 * The `worker` process role (plan P1): the BullMQ processors and their schedules. main.ts imports it when APP_ROLE
 * contains `worker`. Needs the global ConfigModule, logger, PrismaModule and RedisModule (as AppModule provides them);
 * brings its own queues (QueueModule), vault, broker gateways, token renewal and broker events (BrokersModule).
 */
@Module({
  imports: [QueueModule, AuditModule, BrokersModule, InstrumentsModule],
  providers: [
    InstrumentMasterSyncProcessor,
    InstrumentMasterSyncStartup,
    BrokerTokenExpiryProcessor,
    BrokerTokenExpiryService,
    BrokerTokenExpiryRepository,
    BrokerTokenRenewProcessor,
    BrokerTokenRenewService,
    BrokerTokenRenewRepository,
    JobSchedulerService,
    { provide: CLOCK, useValue: systemClock },
  ],
})
export class WorkerModule {}
