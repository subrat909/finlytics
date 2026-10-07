/**
 * The realtime WebSocket contract (phase 1 plan "WebSocket"): Socket.IO namespace `/rt` on path `/rt/socket.io`, with
 * `socket.io-msgpack-parser` on both ends. The api validates every client message with these schemas; the web app
 * uses them for types and for the payloads it sends.
 *
 * - Client → server: `sub` {@link RtSubscribeSchema} with an ack {@link RtSubscribeAck}; `unsub` {@link RtUnsubscribeSchema}
 *   (ack `{ ok }` when the client passes one).
 * - Server → client: `q` {@link RtQuoteBatch}, coalesced every 100 ms and at most 10 updates per second per instrument;
 *   `status` {@link RtStatus}.
 * - Market depth (plan phase-1b "Realtime"): `dsub` {@link RtDepthSubscribeSchema} (ack {@link RtDepthAck}) streams
 *   `depth` {@link RtDepth} for at most {@link RT_MAX_DEPTH_KEYS} keys per socket, at most 4 per second per key;
 *   `dunsub` stops it. Depth keys must also be in the socket's `sub` set.
 */
import { z } from "zod";

import { InstrumentKeySchema, MAX_INSTRUMENT_KEY_LENGTH } from "../instrument-key";
import { DecimalStringSchema, PriceSchema } from "../money";

import { BrokerCodeSchema } from "./enums";

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
  depthSubscribe: "dsub",
  depthUnsubscribe: "dunsub",
  depth: "depth",
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
 * One quote row: `[key, ltp, chg, chgPct, vol, ts, open, high, low, close, oi, atp]`. Prices are decimal strings;
 * `chg` and `chgPct` are `"0"` when the previous close isn't known; `vol` is the day's volume (0 when unknown); `ts`
 * is the exchange time, epoch ms. The day's `open`/`high`/`low`, the previous `close`, open interest and the average
 * traded price are null until the feed has them (an index has no `oi` or `atp`).
 */
export const RtQuoteRowSchema = z.tuple([
  InstrumentKeySchema,
  PriceSchema,
  DecimalStringSchema,
  DecimalStringSchema,
  z.int().min(0),
  z.int().min(0),
  PriceSchema.nullable(),
  PriceSchema.nullable(),
  PriceSchema.nullable(),
  PriceSchema.nullable(),
  z.int().min(0).nullable(),
  PriceSchema.nullable(),
]);
export type RtQuoteRow = z.infer<typeof RtQuoteRowSchema>;

/** `q`: the rows that changed since the last flush. `t` is the server's send time, epoch ms. */
export const RtQuoteBatchSchema = z.strictObject({ t: z.int().min(0), d: z.array(RtQuoteRowSchema) });
export type RtQuoteBatch = z.infer<typeof RtQuoteBatchSchema>;

/** The shared market feed's state: `stale` while it is connected but no tick arrived recently. */
export const RT_FEED_STATES = Object.freeze(["up", "down", "stale"] as const);
export const RtFeedStateSchema = z.enum(RT_FEED_STATES);
export type RtFeedState = z.infer<typeof RtFeedStateSchema>;

/**
 * `status`: sent on connect and on every change. `source` is the broker whose feed drives every quote (`PAPER` = the
 * simulator); `live` is false for simulated prices, and the UI must say so.
 */
export const RtStatusSchema = z.strictObject({ feed: RtFeedStateSchema, source: BrokerCodeSchema, live: z.boolean() });
export type RtStatus = z.infer<typeof RtStatusSchema>;

/** Socket.IO `connect_error` messages the server uses (`error.message`). */
export const RT_CONNECT_ERRORS = Object.freeze({
  unauthenticated: "UNAUTHENTICATED",
  forbiddenOrigin: "FORBIDDEN_ORIGIN",
  rateLimited: "RATE_LIMITED",
  unavailable: "SERVICE_UNAVAILABLE",
} as const);

/** The most depth streams one socket may hold (the watchlist's expanded row plus the chart's panel). */
export const RT_MAX_DEPTH_KEYS = 3;

/** `dsub` / `dunsub` payload: one key. */
export const RtDepthSubscribeSchema = z.strictObject({ key: z.string().max(MAX_INSTRUMENT_KEY_LENGTH * 2) });
export type RtDepthSubscribe = z.infer<typeof RtDepthSubscribeSchema>;

/**
 * The `dsub` ack: `ok` false with a reason when refused (the reasons of `sub`): `invalid_key` also for a key the socket
 * doesn't hold through `sub`, `limit` beyond {@link RT_MAX_DEPTH_KEYS}. The `dunsub` ack is `{ ok }`.
 */
export const RtDepthAckSchema = z.strictObject({ ok: z.boolean(), reason: RtRejectReasonSchema.optional() });
export type RtDepthAck = z.infer<typeof RtDepthAckSchema>;

/** One book level: `[price, quantity, orders]` (orders 0 when the broker doesn't send it). */
export const RtDepthLevelSchema = z.tuple([PriceSchema, z.int().min(0), z.int().min(0)]);
export type RtDepthLevel = z.infer<typeof RtDepthLevelSchema>;

/**
 * `depth`: the book for one key, best first (5 levels from Upstox `full` and Dhan `full`). `tbq`/`tsq` are the
 * total buy/sell quantities when the broker sends them. `t` is the exchange time, epoch ms.
 */
export const RtDepthSchema = z.strictObject({
  k: InstrumentKeySchema,
  t: z.int().min(0),
  bids: z.array(RtDepthLevelSchema).max(20),
  asks: z.array(RtDepthLevelSchema).max(20),
  tbq: z.int().min(0).nullable(),
  tsq: z.int().min(0).nullable(),
});
export type RtDepth = z.infer<typeof RtDepthSchema>;
