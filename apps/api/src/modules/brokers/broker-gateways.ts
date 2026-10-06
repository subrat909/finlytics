/**
 * Access to brokers (plan P4–P6; broker.md "Never bypass BrokerGateway"): every broker call in the api goes through a
 * `BrokerGateway` built here from the `BrokerRegistry` of @finlytics/broker-sdk. Nothing else constructs adapters.
 *
 * - `gateway(broker)`: the process's one gateway per broker (it owns that broker's single market feed).
 * - `appGateway(broker, app)`: a gateway over an adapter built with a user's own broker app credentials (Upstox: each
 *   user registers their app), for `getAuthUrl` and `exchangeToken`. It shares this process's circuit breakers and the
 *   Redis rate limiter, so budgets are the same as through the shared gateway.
 *
 * Adapter factory options: PAPER gets an in-memory quote source; every other broker gets
 * `{ appCredentials?: { apiKey, apiSecret } }` (Secret-wrapped, the DefaultBrokerFactoryOptions shape).
 */
import {
  BrokerGateway,
  BrokerRateLimiter,
  CircuitBreakerRegistry,
  createBrokerRegistry,
  MemoryQuoteSource,
  Secret,
} from "@finlytics/broker-sdk";
import type {
  BrokerFactoryOptions,
  BrokerLogger,
  BrokerRegistry,
  DefaultBrokerFactoryOptions,
  PaperAdapterOptions,
  RateLimiter,
} from "@finlytics/broker-sdk";
import type { BrokerCode } from "@finlytics/shared";
import { Inject, Injectable, Module } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RedisService } from "../../infra/redis/redis.service";

import { BrokerDomainError } from "./broker-errors";

/** The injection token of the BrokerRegistry (tests provide one with fake adapters). */
export const BROKER_REGISTRY = Symbol("BROKER_REGISTRY");

/** The rate limiter the gateways use (tests may provide an in-memory one). */
export const BROKER_RATE_LIMITER = Symbol("BROKER_RATE_LIMITER");

/** A user's own broker app (Upstox), in plaintext only for the moment an adapter is built. */
export interface BrokerAppCredentials {
  readonly apiKey: string;
  readonly apiSecret: string;
}

/** The factory options for `broker`. */
export function adapterOptions(broker: BrokerCode, app?: BrokerAppCredentials): BrokerFactoryOptions<BrokerCode> {
  if (broker === "PAPER") return { quotes: new MemoryQuoteSource() } satisfies PaperAdapterOptions;
  if (app === undefined) return {} satisfies DefaultBrokerFactoryOptions;
  return {
    appCredentials: { apiKey: Secret.of(app.apiKey), apiSecret: Secret.of(app.apiSecret) },
  } satisfies DefaultBrokerFactoryOptions;
}

@Injectable()
export class BrokerGateways implements OnApplicationShutdown {
  readonly #gateways = new Map<BrokerCode, BrokerGateway>();
  readonly #breakers = new CircuitBreakerRegistry();
  readonly #logger: BrokerLogger;

  constructor(
    @Inject(BROKER_REGISTRY) private readonly registry: BrokerRegistry,
    @Inject(BROKER_RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    logger: PinoLogger,
  ) {
    logger.setContext(BrokerGateways.name);
    this.#logger = {
      debug: (fields, message) => {
        logger.debug(fields, message);
      },
      warn: (fields, message) => {
        logger.warn(fields, message);
      },
    };
  }

  /** Whether an adapter is registered for `broker`. */
  has(broker: BrokerCode): boolean {
    return this.registry.has(broker);
  }

  /** The registered brokers. */
  codes(): BrokerCode[] {
    return this.registry.codes();
  }

  /** The shared gateway of `broker`. @throws {BrokerDomainError} (BROKER_UNAVAILABLE) when none is registered. */
  gateway(broker: BrokerCode): BrokerGateway {
    let gateway = this.#gateways.get(broker);
    if (gateway === undefined) {
      gateway = this.#build(broker);
      this.#gateways.set(broker, gateway);
    }
    return gateway;
  }

  /** A gateway for a user's own broker app (not cached: it carries their app credentials). */
  appGateway(broker: BrokerCode, app: BrokerAppCredentials): BrokerGateway {
    return this.#build(broker, app);
  }

  async onApplicationShutdown(): Promise<void> {
    const gateways = [...this.#gateways.values()];
    this.#gateways.clear();
    await Promise.all(gateways.map((gateway) => gateway.close()));
  }

  #build(broker: BrokerCode, app?: BrokerAppCredentials): BrokerGateway {
    if (!this.registry.has(broker)) {
      throw new BrokerDomainError("BROKER_UNAVAILABLE", `${broker} is not available on this server.`);
    }
    return new BrokerGateway({
      adapter: this.registry.create(broker, adapterOptions(broker, app)),
      rateLimiter: this.rateLimiter,
      breakers: this.#breakers,
      logger: this.#logger,
    });
  }
}

/**
 * The registry and gateways, for every module that talks to brokers (brokers, instruments, the worker, the feed). The
 * default registry is @finlytics/broker-sdk's; the rate limiter keeps its buckets in Redis.
 */
@Module({
  providers: [
    { provide: BROKER_REGISTRY, useFactory: () => createBrokerRegistry() },
    {
      provide: BROKER_RATE_LIMITER,
      inject: [RedisService],
      useFactory: (redis: RedisService): RateLimiter => new BrokerRateLimiter(redis.client),
    },
    BrokerGateways,
  ],
  exports: [BrokerGateways],
})
export class BrokerGatewaysModule {}
