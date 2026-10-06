import { Module } from "@nestjs/common";

import { CLOCK, systemClock } from "../../common/clock";

import { SessionRepository } from "./session.repository";
import { SessionService } from "./session.service";

/**
 * Session authentication against the Auth.js `Session` table. SessionGuard and AuthGuard are registered globally, in
 * order, by AppModule (APP_GUARD); this module provides the SessionService they use.
 */
@Module({
  providers: [SessionRepository, SessionService, { provide: CLOCK, useValue: systemClock }],
  exports: [SessionService],
})
export class AuthModule {}
