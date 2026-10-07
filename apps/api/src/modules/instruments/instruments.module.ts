import { Module } from "@nestjs/common";

import { CLOCK, systemClock } from "../../common/clock";
import { QueueModule } from "../../infra/queue/queue.module";
import { AuditModule } from "../audit/audit.module";
import { BrokerGatewaysModule } from "../brokers/broker-gateways";

import { InstrumentMasterService } from "./instrument-master.service";
import { InstrumentsAdminController, InstrumentsController } from "./instruments.controller";
import { InstrumentsRepository } from "./instruments.repository";
import { InstrumentsService } from "./instruments.service";

/** `/v1/instruments`, `/v1/admin/instruments/sync`, and the master import the worker runs (InstrumentMasterService). */
@Module({
  imports: [AuditModule, BrokerGatewaysModule, QueueModule],
  controllers: [InstrumentsController, InstrumentsAdminController],
  providers: [
    InstrumentsRepository,
    InstrumentsService,
    InstrumentMasterService,
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [InstrumentsRepository, InstrumentMasterService],
})
export class InstrumentsModule {}
