/**
 * Domain events the market-data side listens to (`@nestjs/event-emitter`, in-process, emitted after commit):
 *
 * - `broker.account.activated` / `broker.account.deactivated` `{userId, accountId, broker}` (the brokers module):
 *   the feed chooses its source again; an activation queues the broker's instrument master when it is stale.
 * - `instruments.synced` `{broker, rows}` (the instrument-master import): the feed chooses its source again.
 *
 * Payloads are validated before use; a malformed one is ignored.
 */
import { BrokerCodeSchema } from "@finlytics/shared";
import { z } from "zod";

import { BROKER_ACCOUNT_EVENTS } from "../modules/brokers/broker-events";
import { INSTRUMENTS_SYNCED_EVENT } from "../modules/brokers/broker-instruments";

/** The event names, from the modules that own them (brokers: account events and the instrument maps' reload). */
export const FEED_EVENTS = Object.freeze({
  brokerAccountActivated: BROKER_ACCOUNT_EVENTS.activated,
  brokerAccountDeactivated: BROKER_ACCOUNT_EVENTS.deactivated,
  instrumentsSynced: INSTRUMENTS_SYNCED_EVENT,
} as const);

export const BrokerAccountEventSchema = z.object({
  userId: z.string().min(1).max(64),
  accountId: z.string().min(1).max(64),
  broker: BrokerCodeSchema,
});
export type BrokerAccountEvent = z.infer<typeof BrokerAccountEventSchema>;

export const InstrumentsSyncedEventSchema = z.object({ broker: BrokerCodeSchema, rows: z.int().min(0) });
export type InstrumentsSyncedEvent = z.infer<typeof InstrumentsSyncedEventSchema>;
