import { Module } from "@nestjs/common";

import { CLOCK, systemClock } from "../../common/clock";
import { VaultModule } from "../../infra/vault/vault.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";

import { BrokerAccessService } from "./broker-access.service";
import { BrokerGatewaysModule } from "./broker-gateways";
import { BrokersController } from "./brokers.controller";
import { BrokersRepository } from "./brokers.repository";
import { BrokersService } from "./brokers.service";
import { OAuthStateService } from "./oauth-state.service";

/**
 * `/v1/brokers` and BrokerAccessService (connected accounts for other modules), with the vault and the gateways
 * (BrokerGatewaysModule, re-exported for modules that call brokers without an account, such as the instrument master).
 */
@Module({
  imports: [AuditModule, AuthModule, BrokerGatewaysModule, VaultModule],
  controllers: [BrokersController],
  providers: [
    BrokersRepository,
    BrokersService,
    BrokerAccessService,
    OAuthStateService,
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [BrokerAccessService, BrokerGatewaysModule],
})
export class BrokersModule {}
