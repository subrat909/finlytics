import { Module } from "@nestjs/common";

import { CLOCK, systemClock } from "../../common/clock";
import { VaultModule } from "../../infra/vault/vault.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";

import { BrokerAccessService } from "./broker-access.service";
import { BrokerEvents } from "./broker-events";
import { BrokerGatewaysModule } from "./broker-gateways";
import { BrokerTokenService } from "./broker-token.service";
import { BrokersController } from "./brokers.controller";
import { BrokersRepository } from "./brokers.repository";
import { BrokersService } from "./brokers.service";
import { OAuthStateService } from "./oauth-state.service";

/**
 * `/v1/brokers` and, for other modules: BrokerAccessService (connected accounts), BrokerTokenService (token renewal,
 * for the worker), BrokerEvents (the `broker.account.*` events; EventEmitterModule is registered once in AppModule),
 * the vault and the gateways (BrokerGatewaysModule, re-exported for modules that call brokers without an account, such
 * as the instrument master).
 */
@Module({
  imports: [AuditModule, AuthModule, BrokerGatewaysModule, VaultModule],
  controllers: [BrokersController],
  providers: [
    BrokersRepository,
    BrokersService,
    BrokerAccessService,
    BrokerEvents,
    BrokerTokenService,
    OAuthStateService,
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [BrokerAccessService, BrokerEvents, BrokerTokenService, BrokerGatewaysModule],
})
export class BrokersModule {}
