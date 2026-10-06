/**
 * The realtime WebSocket contract (phase 1 plan "WebSocket"): Socket.IO namespace `/rt` on path `/rt/socket.io`, with
 * `socket.io-msgpack-parser` on both ends. The api validates every client message with these schemas; the web app
 * uses them for types and for the payloads it sends.
 *
 * - Client → server: `sub` {@link RtSubscribeSchema} with an ack {@link RtSubscribeAck}; `unsub` {@link RtUnsubscribeSchema}
 *   (ack `{ ok }` when the client passes one).
 * - Server → client: `q` {@link RtQuoteBatch}, coalesced every 100 ms and at most 10 updates per second per instrument;
 *   `status` {@link RtStatus}.
 */
import { z } from "zod";

import { InstrumentKeySchema, MAX_INSTRUMENT_KEY_LENGTH } from "../instrument-key";
import { DecimalStringSchema, PriceSchema } from "../money";

/** The Socket.IO namespace. */
export const RT_NAMESPACE = "/rt";

/** The Engine.IO path (the ingress routes it to the gateway). */
export const RT_PATH = "/rt/socket.io";

/** Event names, both directions. */
export const RT_EVENTS = Object.freeze({
  subscribe: "sub",
  unsubscribe: "unsub",
  quotes: "q",
  status: "status",
} as const);

/** The most keys one `sub`/`unsub` message may carry (the per-socket limit is the plan's `maxRtSubscriptions`). */
export const RT_MAX_KEYS_PER_MESSAGE = 200;

/** How often the server flushes coalesced quotes, and so the most updates per instrument per second (10). */
export const RT_COALESCE_MS = 100;

/** Why the server refused a key in a `sub`. */
export const RT_REJECT_REASONS = Object.freeze([
  /** Not a canonical instrument key. */
  "invalid_key",
  /** A well-formed key that names no active instrument. */
  "unknown_instrument",
  /** The socket already holds the plan's `maxRtSubscriptions`. */
  "limit",
  /** Too many messages in a short time. */
  "rate_limited",
  /** The server could not record the subscription (Redis down); retry. */
  "unavailable",
] as const);
export const RtRejectReasonSchema = z.enum(RT_REJECT_REASONS);
export type RtRejectReason = z.infer<typeof RtRejectReasonSchema>;

/**
 * Raw keys as the client sends them: strings, at most {@link RT_MAX_KEYS_PER_MESSAGE}. Each key is checked one by one
 * (an invalid key is rejected in the ack, it doesn't fail the whole message).
 */
const RawKeysSchema = z
  .array(z.string().max(MAX_INSTRUMENT_KEY_LENGTH * 2))
  .min(1)
  .max(RT_MAX_KEYS_PER_MESSAGE);

/** `sub` payload. */
export const RtSubscribeSchema = z.strictObject({ keys: RawKeysSchema });
export type RtSubscribe = z.infer<typeof RtSubscribeSchema>;

/** `unsub` payload. */
export const RtUnsubscribeSchema = z.strictObject({ keys: RawKeysSchema });
export type RtUnsubscribe = z.infer<typeof RtUnsubscribeSchema>;

/** The `sub` ack: the keys now subscribed (including ones that already were), and the refused ones with a reason. */
export const RtSubscribeAckSchema = z.strictObject({
  ok: z.array(InstrumentKeySchema),
  rejected: z.array(z.strictObject({ key: z.string(), reason: RtRejectReasonSchema })),
});
export type RtSubscribeAck = z.infer<typeof RtSubscribeAckSchema>;

/** The `unsub` ack: the keys that were removed. */
export const RtUnsubscribeAckSchema = z.strictObject({ ok: z.array(InstrumentKeySchema) });
export type RtUnsubscribeAck = z.infer<typeof RtUnsubscribeAckSchema>;

/**
 * One quote row: `[key, ltp, chg, chgPct, vol, ts]`. Prices are decimal strings; `chg` and `chgPct` are `"0"` when the
 * previous close isn't known; `vol` is the day's volume (0 when unknown); `ts` is the exchange time, epoch ms.
 */
export const RtQuoteRowSchema = z.tuple([
  InstrumentKeySchema,
  PriceSchema,
  DecimalStringSchema,
  DecimalStringSchema,
  z.int().min(0),
  z.int().min(0),
]);
export type RtQuoteRow = z.infer<typeof RtQuoteRowSchema>;

/** `q`: the rows that changed since the last flush. `t` is the server's send time, epoch ms. */
export const RtQuoteBatchSchema = z.strictObject({ t: z.int().min(0), d: z.array(RtQuoteRowSchema) });
export type RtQuoteBatch = z.infer<typeof RtQuoteBatchSchema>;

/** The shared market feed's state: `stale` while it is connected but no tick arrived recently. */
export const RT_FEED_STATES = Object.freeze(["up", "down", "stale"] as const);
export const RtFeedStateSchema = z.enum(RT_FEED_STATES);
export type RtFeedState = z.infer<typeof RtFeedStateSchema>;

/** `status`: sent on connect and on every change. */
export const RtStatusSchema = z.strictObject({ feed: RtFeedStateSchema });
export type RtStatus = z.infer<typeof RtStatusSchema>;

/** Socket.IO `connect_error` messages the server uses (`error.message`). */
export const RT_CONNECT_ERRORS = Object.freeze({
  unauthenticated: "UNAUTHENTICATED",
  forbiddenOrigin: "FORBIDDEN_ORIGIN",
  rateLimited: "RATE_LIMITED",
  unavailable: "SERVICE_UNAVAILABLE",
} as const);
