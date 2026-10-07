/**
 * Broker account domain events (plan phase-1b "Portfolio, brokers, plans, tokens"; backend.md "emit domain events
 * instead of cross-module calls"), emitted with @nestjs/event-emitter only after the change has committed:
 *
 * | Event                        | When                                                                              |
 * |------------------------------|-----------------------------------------------------------------------------------|
 * | `broker.account.activated`   | an account became (or stays, with a new token) ACTIVE: the Upstox callback, a Dhan or paper connect, a renewed token |
 * | `broker.account.deactivated` | an account stopped being usable: deleted, NEEDS_RELOGIN (refused, expired or not renewed) |
 *
 * The payload is `{ userId, accountId, broker }` and nothing else: never credentials, tokens or the client id. A
 * listener that throws can't fail the change that already happened: emission errors are logged and swallowed.
 */
import type { BrokerCode } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PinoLogger } from "nestjs-pino";

export const BROKER_ACCOUNT_EVENTS = Object.freeze({
  activated: "broker.account.activated",
  deactivated: "broker.account.deactivated",
} as const);
export type BrokerAccountEventName = (typeof BROKER_ACCOUNT_EVENTS)[keyof typeof BROKER_ACCOUNT_EVENTS];

/** The payload of every `broker.account.*` event. */
export interface BrokerAccountEvent {
  readonly userId: string;
  readonly accountId: string;
  readonly broker: BrokerCode;
}

@Injectable()
export class BrokerEvents {
  constructor(
    private readonly emitter: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(BrokerEvents.name);
  }

  /** `broker.account.activated`: call after the transaction that activated the account has committed. */
  activated(event: BrokerAccountEvent): void {
    this.emit(BROKER_ACCOUNT_EVENTS.activated, event);
  }

  /** `broker.account.deactivated`: call after the transaction that deactivated (or deleted) the account committed. */
  deactivated(event: BrokerAccountEvent): void {
    this.emit(BROKER_ACCOUNT_EVENTS.deactivated, event);
  }

  private emit(name: BrokerAccountEventName, event: BrokerAccountEvent): void {
    // A fresh object with exactly the three fields: nothing else a caller had on hand can ride along.
    const payload: BrokerAccountEvent = { userId: event.userId, accountId: event.accountId, broker: event.broker };
    try {
      this.emitter.emit(name, payload);
    } catch (error: unknown) {
      this.logger.error({ err: error, event: name, brokerAccountId: event.accountId }, "broker event listener failed");
    }
  }
}
