/**
 * Announces user-facing changes to the realtime gateway (plan phase-1c "Notifications"): broker account events (which
 * also write the broker notifications) are published on Redis `rt:user` as `{userId, kind}`; every gateway pod emits a
 * `user` event to its local `user:<id>` room, and the browser refetches. Runs in every process that emits the events.
 */
import type { RtUserEvent } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PinoLogger } from "nestjs-pino";

import { redisKeys } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import { BROKER_ACCOUNT_EVENTS } from "../brokers/broker-events";
import type { BrokerAccountEvent } from "../brokers/broker-events";

@Injectable()
export class UserEventsRelay {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(UserEventsRelay.name);
  }

  /** Publishes one user event; failures are logged, never thrown (the change already happened). */
  async publish(userId: string, kind: RtUserEvent["kind"]): Promise<void> {
    try {
      await this.redis.client.publish(redisKeys.userEventsChannel(), JSON.stringify({ userId, kind }));
    } catch (error: unknown) {
      this.logger.warn({ err: error, kind }, "could not publish a user event");
    }
  }

  @OnEvent(BROKER_ACCOUNT_EVENTS.activated)
  @OnEvent(BROKER_ACCOUNT_EVENTS.deactivated)
  onBrokerAccount(event: BrokerAccountEvent): Promise<void> {
    return this.publish(event.userId, "broker");
  }
}
