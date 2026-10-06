import { Module } from "@nestjs/common";

import { RateLimitModule } from "../../common/rate-limit/rate-limit.module";
import { AuthModule } from "../auth/auth.module";

import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeRepository } from "./realtime.repository";
import { RealtimeService } from "./realtime.service";

/**
 * The `gateway` role (phase 1 plan "WebSocket"): Socket.IO `/rt`. bootstrap installs RealtimeIoAdapter
 * (./realtime-io.adapter.ts) before init whenever this module is part of the app.
 */
@Module({
  imports: [AuthModule, RateLimitModule],
  providers: [RealtimeRepository, RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
