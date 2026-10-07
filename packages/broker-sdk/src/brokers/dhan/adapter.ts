/**
 * DhanAdapter: DhanHQ v2 (https://dhanhq.co/docs/v2/, re-read 2026-10-06) behind the 12-operation BrokerAdapter.
 *
 * Rate limits (Dhan, per user; the gateway enforces the per-second ones, see rate-limit/limits.ts):
 * - Order APIs (place, modify, cancel): 10/s, 250/min, 1000/h, 7000/day; at most 25 modifications per order.
 * - Data APIs (historical and intraday charts): 5/s, 100000/day.
 * - Quote APIs (market quote): 1/s. Unused: quotes come from the market feed (broker.md).
 * - Non-trading APIs (profile, funds, order book, positions, holdings): 20/s.
 * - Option chain: 1 unique request per 3 s. Unused: the platform builds option chains from the market feed.
 * - Market feed: 5 connections per user, 5000 instruments per connection, 100 per subscribe message.
 * Longer windows than a second surface as DH-904 / 805 / HTTP 429 → RateLimitedError.
 *
 * Quirks:
 * - Auth is a pasted access token (`authMode: "token"`, fields `clientId` + `accessToken`); no OAuth. Since v2.4
 *   (Sep 2025) a dashboard token lasts 24 hours, not 30 days; `GET /RenewToken` (headers `access-token` +
 *   `dhanClientId`) swaps a live token for a new 24-hour one, so `refreshToken` works until the token has expired (then
 *   NEEDS_RELOGIN). Its answer is undocumented: `{ accessToken, expiryTime }`, snake case, a `data` envelope or the bare
 *   token are all read. `expiresAt` comes from the JWT `exp`, else the answer, else 24 hours from now.
 * - Connecting must not fail on cosmetics: the paste is cleaned (whitespace, quotes, `Bearer `), the client id may be
 *   left empty (the JWT's `dhanClientId` claim or the profile supplies it), and `/profile` is read forgivingly (numbers
 *   for strings, nulls, extra fields; `tokenValidity` `DD/MM/YYYY HH:mm` IST or other date forms). An expired JWT or
 *   one for another client id is refused before Dhan is called.
 * - Errors come as `{ errorType, errorCode, errorMessage }`, or in the older `{ status: "failure", remarks: {
 *   error_code, ... } }` form, sometimes with HTTP 200: both are read (./http.ts). DH-901 / 807–810 → NEEDS_RELOGIN.
 * - List reads (order book, positions, holdings) skip a row they can't read or whose instrument nobody can identify,
 *   instead of failing the whole list. Positions carry no LTP; `close` is not reported either.
 * - Order, order-book and update payloads name instruments by `(exchangeSegment, securityId)`; the adapter maps them
 *   through a {@link DhanInstrumentMap} that `downloadInstrumentMaster` fills (or the api loads from its reverse map).
 *   Rows the map doesn't know fall back to their own symbol and derivative fields.
 * - Products: DELIVERY → CNC for cash, MARGIN (carry forward) for F&O. CO/BO need legs the contract doesn't carry and
 *   are refused before the broker.
 * - `modifyOrder` reads the order first (GET /orders/{id}): Dhan's PUT wants the whole order, not a patch.
 * - Static IP whitelisting is mandatory for place, modify and cancel (SEBI); a non-whitelisted IP is a rejection.
 * - Times are IST wall clock (`2021-11-24 13:33:03`) → ISO with +05:30. Chart timestamps are epoch seconds.
 * - Intraday charts: 1, 5, 15, 25, 60 minutes and ≤ 90 days per request (longer ranges are fetched in 90-day chunks);
 *   M3 is aggregated from M1 and M30 from M15, aligned to the session open.
 * - `TICK_SIZE` in the scrip master is in paise; no freeze quantity column (`freezeQuantities` supplies it).
 * - Holdings say `exchange: "ALL"`: resolved through NSE, then BSE.
 */
import type { InstrumentKey } from "@finlytics/shared";
import { z } from "zod";

import type { AccountCallContext, BrokerAdapter, BrokerCapabilities, CallContext } from "../../adapter";
import { Secret } from "../../credentials";
import type { BrokerCredentials } from "../../credentials";
import {
  BrokerInputError,
  BrokerNotFoundError,
  BrokerRejectedError,
  isBrokerError,
  NeedsReloginError,
} from "../../errors";
import type { MarketFeed, OrderFeed } from "../../feed/feed";
import type {
  AuthStart,
  BrokerHolding,
  BrokerOrder,
  BrokerPosition,
  Candle,
  CandleQuery,
  ExchangeTokenInput,
  Funds,
  InstrumentRow,
  ModifyOrderInput,
  PlaceOrderInput,
  PlaceOrderResult,
  Profile,
} from "../../models";

import { DhanMarketFeed, DhanOrderFeed, nativeWebSocket } from "./feed";
import type { DhanFeedOptions, DhanWebSocketFactory } from "./feed";
import { dhanError, dhanRequest, unexpectedAnswer } from "./http";
import type { DhanFetch, DhanRequest } from "./http";
import { csvRecords, decodeUtf8, dhanMasterRow, DhanInstrumentMap } from "./instruments";
import type { DhanInstrumentRef } from "./instruments";
import {
  aggregateCandles,
  candlePlan,
  cleanToken,
  finaliseCandles,
  istDate,
  istToDate,
  istWallClock,
  jwtClientId,
  jwtExpiry,
  orderKeyOf,
  parsedKey,
  renewedToken,
  toBrokerHolding,
  toBrokerOrder,
  toBrokerPosition,
  toCandles,
  toDhanOrderType,
  toDhanProduct,
  toFunds,
  toProfile,
} from "./mappers";
import {
  DHAN_API_BASE_URL,
  DHAN_FEED_MAX_INSTRUMENTS,
  DHAN_FEED_URL,
  DHAN_INTRADAY_MAX_DAYS,
  DHAN_ORDER_UPDATE_URL,
  DHAN_PATHS,
  DHAN_SCRIP_MASTER_URL,
  DhanCandlesSchema,
  DhanFundLimitSchema,
  DhanHoldingSchema,
  DhanOrderAckSchema,
  DhanOrderSchema,
  DhanPositionSchema,
  DhanProfileSchema,
  DHAN_TOKEN_VALIDITY_MS,
} from "./types";
import type {
  DhanCandles,
  DhanHistoricalRequest,
  DhanIntradayRequest,
  DhanModifyOrderRequest,
  DhanOrder,
  DhanPlaceOrderRequest,
  DhanProfile,
} from "./types";

export interface DhanAdapterOptions {
  /** Defaults to Node's global fetch. */
  readonly fetch?: DhanFetch | undefined;
  /** Defaults to Node's global WebSocket. */
  readonly webSocket?: DhanWebSocketFactory | undefined;
  /** The instrument map shared by orders and feeds (default: a new, empty one that the master download fills). */
  readonly instruments?: DhanInstrumentMap | undefined;
  readonly baseUrl?: string | undefined;
  readonly feedUrl?: string | undefined;
  readonly orderUpdateUrl?: string | undefined;
  readonly scripMasterUrl?: string | undefined;
  /** Unit of the master's `TICK_SIZE` (default `paise`). */
  readonly tickSizeUnit?: "paise" | "rupee" | undefined;
  /** Exchange freeze quantities per F&O underlying (`{ NIFTY: 1800 }`). */
  readonly freezeQuantities?: Readonly<Record<string, number>> | undefined;
  /** Reconnect, heartbeat and clock for both feeds. */
  readonly feed?: DhanFeedOptions | undefined;
  readonly now?: (() => Date) | undefined;
}

/** 5000 instruments per connection in any mix of ticker, quote and full (100 per subscribe message). */
const DHAN_FEED_LIMITS = Object.freeze({
  ltp: DHAN_FEED_MAX_INSTRUMENTS,
  quote: DHAN_FEED_MAX_INSTRUMENTS,
  full: DHAN_FEED_MAX_INSTRUMENTS,
});

export const DHAN_CAPABILITIES: BrokerCapabilities = Object.freeze({
  authMode: "token",
  refreshable: true,
  maxFeedInstruments: DHAN_FEED_MAX_INSTRUMENTS,
  feedLimits: Object.freeze({ single: DHAN_FEED_LIMITS, mixed: DHAN_FEED_LIMITS }),
  orderFeedScope: "account",
});

/** What the connect form asks for (AuthStart `token` mode). */
const TOKEN_FIELDS: AuthStart = Object.freeze({
  mode: "token",
  fields: [
    { name: "clientId", label: "Dhan client ID", secret: false },
    { name: "accessToken", label: "Access token (web.dhan.co → My Profile → Access DhanHQ APIs)", secret: true },
  ],
});

const CLIENT_ID = /^[A-Za-z0-9]{1,32}$/;
const MS_PER_DAY = 86_400_000;
const BROKER = "DHAN" as const;

function parseOr<T>(schema: z.ZodType<T>, value: unknown, operation: DhanRequest["operation"]): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw unexpectedAnswer(operation);
  return parsed.data;
}

/**
 * The rows of a list answer: an empty body is no rows; a row in a shape we can't read is skipped, not fatal (one odd
 * row must not hide the rest). A `{ data: [...] }` envelope is opened; anything else that isn't a list is unexpected.
 */
function rowsOf<T>(body: unknown, schema: z.ZodType<T>, operation: DhanRequest["operation"]): T[] {
  if (body === undefined || body === null) return [];
  const data: unknown = typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  const list: unknown[] | undefined = Array.isArray(body) ? body : Array.isArray(data) ? data : undefined;
  if (list === undefined) throw unexpectedAnswer(operation);
  return list.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The account's Dhan client id (orders, RenewToken and both feeds need it). */
function clientIdOf(creds: BrokerCredentials): string {
  const clientId = creds.clientId;
  if (clientId === undefined || !CLIENT_ID.test(clientId)) {
    throw new NeedsReloginError("The Dhan credentials have no client id; connect the account again", {
      broker: BROKER,
    });
  }
  return clientId;
}

/** NOT_FOUND on a list read means "nothing there" at Dhan (DH-907: no data). */
async function emptyWhenNotFound<T>(promise: Promise<T[]>): Promise<T[]> {
  try {
    return await promise;
  } catch (error: unknown) {
    if (isBrokerError(error) && error.code === "NOT_FOUND") return [];
    throw error;
  }
}

export class DhanAdapter implements BrokerAdapter {
  readonly code = "DHAN";
  readonly capabilities = DHAN_CAPABILITIES;

  readonly #fetch: DhanFetch;
  readonly #webSocket: DhanWebSocketFactory;
  readonly #instruments: DhanInstrumentMap;
  readonly #baseUrl: string;
  readonly #feedUrl: string;
  readonly #orderUpdateUrl: string;
  readonly #scripMasterUrl: string;
  readonly #options: DhanAdapterOptions;
  readonly #now: () => Date;

  constructor(options: DhanAdapterOptions = {}) {
    this.#options = options;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#webSocket = options.webSocket ?? nativeWebSocket;
    this.#instruments = options.instruments ?? new DhanInstrumentMap();
    this.#baseUrl = options.baseUrl ?? DHAN_API_BASE_URL;
    this.#feedUrl = options.feedUrl ?? DHAN_FEED_URL;
    this.#orderUpdateUrl = options.orderUpdateUrl ?? DHAN_ORDER_UPDATE_URL;
    this.#scripMasterUrl = options.scripMasterUrl ?? DHAN_SCRIP_MASTER_URL;
    this.#now = options.now ?? (() => new Date());
  }

  // 1–2. ---------------------------------------------------------------------------------------------------------------

  /** Dhan has no OAuth for individuals: the user pastes the client id and an access token. No network call. */
  getAuthUrl(): AuthStart {
    return TOKEN_FIELDS;
  }

  /**
   * Checks the pasted token against GET /profile and returns the credentials. Forgiving with what a paste brings
   * (whitespace, quotes, a `Bearer ` prefix); the client id may be left empty, then it comes from the token or the
   * profile. A token that has expired, that Dhan refuses, or that belongs to another client id is BROKER_REJECTED with
   * our own message (the user fixes the form; there is no session to re-login yet).
   */
  async exchangeToken(ctx: CallContext, input: ExchangeTokenInput): Promise<BrokerCredentials> {
    const typedClientId = (input.fields?.clientId ?? "").trim();
    const token = cleanToken(input.fields?.accessToken);
    if (token.length < 16 || token.length > 4096 || (typedClientId !== "" && !CLIENT_ID.test(typedClientId))) {
      throw new BrokerInputError(
        typedClientId !== "" && !CLIENT_ID.test(typedClientId)
          ? "The Dhan client ID has only letters and digits"
          : "Paste the access token from web.dhan.co",
        { broker: BROKER, operation: "exchangeToken" },
      );
    }
    const tokenExpiry = jwtExpiry(token);
    if (tokenExpiry !== undefined && tokenExpiry.getTime() <= this.#now().getTime()) {
      throw this.#rejected("The access token has expired; generate a new one on web.dhan.co", "TOKEN_EXPIRED");
    }
    const tokenClientId = jwtClientId(token);
    if (typedClientId !== "" && tokenClientId !== undefined && tokenClientId !== typedClientId) {
      throw this.#rejected("The access token belongs to another Dhan client ID", "CLIENT_MISMATCH");
    }
    let profile: DhanProfile;
    try {
      profile = parseOr(
        DhanProfileSchema,
        await this.#request({
          method: "GET",
          url: DHAN_PATHS.profile,
          operation: "exchangeToken",
          signal: ctx.signal,
          token,
        }),
        "exchangeToken",
      );
    } catch (error: unknown) {
      if (isBrokerError(error) && error.code === "NEEDS_RELOGIN") {
        throw new BrokerRejectedError("Dhan did not accept the access token", {
          ...error.options,
          operation: "exchangeToken",
        });
      }
      throw error;
    }
    const clientId = typedClientId || tokenClientId || profile.dhanClientId;
    if (profile.dhanClientId !== clientId) {
      throw this.#rejected("The access token belongs to another Dhan client ID", "CLIENT_MISMATCH");
    }
    if (!CLIENT_ID.test(clientId)) throw unexpectedAnswer("exchangeToken");
    const expiresAt = tokenExpiry ?? istToDate(profile.tokenValidity);
    return { accessToken: Secret.of(token), clientId, ...(expiresAt === undefined ? {} : { expiresAt }) };
  }

  /**
   * GET /RenewToken (headers `access-token`, `dhanClientId`): the current token stops working and a new 24-hour one
   * comes back. Only a live token renews; an expired one is NEEDS_RELOGIN. `expiresAt` is the JWT's `exp`, else the
   * answer's expiry, else 24 hours from now.
   */
  async refreshToken(ctx: AccountCallContext): Promise<BrokerCredentials> {
    const clientId = clientIdOf(ctx.creds);
    const renewed = renewedToken(
      await this.#request({
        method: "GET",
        url: DHAN_PATHS.renewToken,
        operation: "refreshToken",
        signal: ctx.signal,
        token: ctx.creds.accessToken.reveal(),
        headers: { dhanClientId: clientId },
        allowText: true,
      }),
    );
    if (renewed === undefined || renewed.token.length < 16) {
      // The old token may already be void: the user has to paste a new one.
      throw new NeedsReloginError("Dhan did not return a renewed token", {
        broker: BROKER,
        operation: "refreshToken",
        brokerError: { code: "UNEXPECTED_RESPONSE" },
      });
    }
    const expiresAt =
      jwtExpiry(renewed.token) ?? istToDate(renewed.expiry) ?? new Date(this.#now().getTime() + DHAN_TOKEN_VALIDITY_MS);
    return { accessToken: Secret.of(renewed.token), clientId, expiresAt };
  }

  // 3–4. ---------------------------------------------------------------------------------------------------------------

  async getProfile(ctx: AccountCallContext): Promise<Profile> {
    const body = await this.#get(ctx, DHAN_PATHS.profile, "getProfile");
    return toProfile(parseOr(DhanProfileSchema, body, "getProfile"));
  }

  async getFunds(ctx: AccountCallContext): Promise<Funds> {
    const body = await this.#get(ctx, DHAN_PATHS.fundLimit, "getFunds");
    return toFunds(parseOr(DhanFundLimitSchema, body, "getFunds"));
  }

  // 5. -----------------------------------------------------------------------------------------------------------------

  /**
   * Streams the scrip-master CSV (no auth) into canonical rows, filling the instrument map as it goes. Rows the
   * platform doesn't trade are skipped; the first row for a key wins.
   */
  async *downloadInstrumentMaster(ctx: CallContext): AsyncIterable<InstrumentRow> {
    ctx.signal.throwIfAborted();
    let response: Response;
    try {
      response = await this.#fetch(this.#scripMasterUrl, { method: "GET", signal: ctx.signal });
    } catch {
      ctx.signal.throwIfAborted();
      throw dhanError(503, undefined, "downloadInstrumentMaster");
    }
    if (!response.ok || response.body === null) {
      throw dhanError(response.ok ? 503 : response.status, undefined, "downloadInstrumentMaster");
    }
    const seen = new Set<InstrumentKey>();
    const options = { tickSizeUnit: this.#options.tickSizeUnit, freezeQuantities: this.#options.freezeQuantities };
    for await (const record of csvRecords(decodeUtf8(response.body))) {
      ctx.signal.throwIfAborted();
      const mapped = dhanMasterRow(record, options);
      if (mapped === undefined || seen.has(mapped.row.instrumentKey)) continue;
      seen.add(mapped.row.instrumentKey);
      this.#instruments.set(mapped.row.instrumentKey, mapped.ref);
      yield mapped.row;
    }
  }

  // 6–9. ---------------------------------------------------------------------------------------------------------------

  async placeOrder(ctx: AccountCallContext, input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const clientId = clientIdOf(ctx.creds);
    const key = parsedKey(input.instrumentKey);
    const ref = this.#ref(input.instrumentKey, "placeOrder");
    const body: DhanPlaceOrderRequest = {
      dhanClientId: clientId,
      ...(input.tag === undefined ? {} : { correlationId: input.tag }),
      transactionType: input.side,
      exchangeSegment: ref.exchangeSegment,
      productType: toDhanProduct(input.product, key),
      orderType: toDhanOrderType(input.type),
      validity: input.validity,
      securityId: ref.securityId,
      quantity: input.qty,
      disclosedQuantity: 0,
      price: input.price === undefined ? 0 : Number(input.price),
      triggerPrice: input.triggerPrice === undefined ? 0 : Number(input.triggerPrice),
      afterMarketOrder: false,
    };
    const ack = parseOr(
      DhanOrderAckSchema,
      await this.#send(ctx, "POST", DHAN_PATHS.orders, "placeOrder", body),
      "placeOrder",
    );
    return { brokerOrderId: ack.orderId };
  }

  /** Reads the order, applies the change, and PUTs the whole order back (Dhan's modify is not a patch). */
  async modifyOrder(ctx: AccountCallContext, input: ModifyOrderInput): Promise<void> {
    const clientId = clientIdOf(ctx.creds);
    const path = `${DHAN_PATHS.orders}/${encodeURIComponent(input.brokerOrderId)}`;
    const current = parseOr(
      z.union([
        DhanOrderSchema,
        z
          .array(DhanOrderSchema)
          .length(1)
          .transform(([order]) => order as DhanOrder),
      ]),
      await this.#get(ctx, path, "modifyOrder"),
      "modifyOrder",
    );
    const orderType = input.type === undefined ? current.orderType : toDhanOrderType(input.type);
    const priced = orderType === "LIMIT" || orderType === "STOP_LOSS";
    const triggered = orderType === "STOP_LOSS" || orderType === "STOP_LOSS_MARKET";
    const body: DhanModifyOrderRequest = {
      dhanClientId: clientId,
      orderId: current.orderId,
      orderType: orderType as DhanModifyOrderRequest["orderType"],
      legName: current.legName ?? "",
      quantity: input.qty ?? current.quantity,
      price: priced ? (input.price === undefined ? (current.price ?? 0) : Number(input.price)) : 0,
      disclosedQuantity: current.disclosedQuantity ?? 0,
      triggerPrice: triggered
        ? input.triggerPrice === undefined
          ? (current.triggerPrice ?? 0)
          : Number(input.triggerPrice)
        : 0,
      validity: input.validity ?? (current.validity === "IOC" ? "IOC" : "DAY"),
    };
    parseOr(DhanOrderAckSchema, await this.#send(ctx, "PUT", path, "modifyOrder", body), "modifyOrder");
  }

  async cancelOrder(ctx: AccountCallContext, brokerOrderId: string): Promise<void> {
    const path = `${DHAN_PATHS.orders}/${encodeURIComponent(brokerOrderId)}`;
    await this.#send(ctx, "DELETE", path, "cancelOrder");
  }

  /** Rows in a shape we can't read, or for instruments neither the map nor the row identifies, are left out. */
  getOrderBook(ctx: AccountCallContext): Promise<BrokerOrder[]> {
    return emptyWhenNotFound(
      this.#get(ctx, DHAN_PATHS.orders, "getOrderBook").then((body) =>
        rowsOf(body, DhanOrderSchema, "getOrderBook").flatMap((order) =>
          orderKeyOf(this.#instruments, order) === undefined
            ? []
            : [toBrokerOrder(this.#instruments, order, this.#now)],
        ),
      ),
    );
  }

  // 10–11. -------------------------------------------------------------------------------------------------------------

  /** Like the order book: unreadable or unidentifiable rows are left out, never the whole answer. */
  getPositions(ctx: AccountCallContext): Promise<BrokerPosition[]> {
    return emptyWhenNotFound(
      this.#get(ctx, DHAN_PATHS.positions, "getPositions").then((body) =>
        rowsOf(body, DhanPositionSchema, "getPositions").flatMap((position) => {
          const mapped = toBrokerPosition(this.#instruments, position);
          return mapped === undefined ? [] : [mapped];
        }),
      ),
    );
  }

  getHoldings(ctx: AccountCallContext): Promise<BrokerHolding[]> {
    return emptyWhenNotFound(
      this.#get(ctx, DHAN_PATHS.holdings, "getHoldings").then((body) =>
        rowsOf(body, DhanHoldingSchema, "getHoldings").flatMap((holding) => {
          const mapped = toBrokerHolding(this.#instruments, holding);
          return mapped === undefined ? [] : [mapped];
        }),
      ),
    );
  }

  /**
   * D1 from /charts/historical; intraday from /charts/intraday in ≤ 90-day requests (sequential, so the data budget
   * of 5/s holds). Candles are returned within `[from, to)`, ascending.
   */
  async getHistoricalCandles(ctx: AccountCallContext, query: CandleQuery): Promise<Candle[]> {
    const key = parsedKey(query.instrumentKey);
    const ref = this.#ref(query.instrumentKey, "getHistoricalCandles");
    const plan = candlePlan(query.timeframe);
    const oi = key.segment === "FUT" || key.segment === "OPT";
    if (query.to.getTime() <= query.from.getTime()) return [];
    const fetchCandles = async (url: string, body: DhanHistoricalRequest | DhanIntradayRequest): Promise<Candle[]> => {
      const answer = await emptyWhenNotFound(
        this.#send(ctx, "POST", url, "getHistoricalCandles", body).then((raw) => [raw]),
      );
      if (answer.length === 0 || answer[0] === undefined) return [];
      const data: DhanCandles = parseOr(DhanCandlesSchema, answer[0], "getHistoricalCandles");
      return toCandles(data);
    };

    let raw: Candle[];
    if (plan.daily) {
      raw = await fetchCandles(DHAN_PATHS.chartsHistorical, {
        securityId: ref.securityId,
        exchangeSegment: ref.exchangeSegment,
        instrument: ref.instrument,
        expiryCode: 0,
        oi,
        fromDate: istDate(query.from),
        // toDate is exclusive at Dhan: the day after the last IST day the range touches.
        toDate: istDate(new Date(query.to.getTime() - 1 + MS_PER_DAY)),
      });
    } else {
      raw = [];
      const chunkMs = DHAN_INTRADAY_MAX_DAYS * MS_PER_DAY;
      for (let start = query.from.getTime(); start < query.to.getTime(); start += chunkMs) {
        const end = Math.min(query.to.getTime(), start + chunkMs);
        raw.push(
          ...(await fetchCandles(DHAN_PATHS.chartsIntraday, {
            securityId: ref.securityId,
            exchangeSegment: ref.exchangeSegment,
            instrument: ref.instrument,
            interval: plan.interval,
            oi,
            fromDate: istWallClock(new Date(start)),
            toDate: istWallClock(new Date(end)),
          })),
        );
      }
    }
    const candles = finaliseCandles(raw, query.from, query.to);
    if (plan.factor === 1) return candles;
    return aggregateCandles(candles, plan.bucketMs, key).filter((candle) => candle.ts >= query.from.getTime());
  }

  // 12. ----------------------------------------------------------------------------------------------------------------

  /** One market-feed WebSocket (the gateway shares it). Keys must be in the instrument map to subscribe. */
  async connectMarketFeed(ctx: AccountCallContext): Promise<MarketFeed> {
    const clientId = clientIdOf(ctx.creds);
    const query = new URLSearchParams({
      version: "2",
      token: ctx.creds.accessToken.reveal(),
      clientId,
      authType: "2",
    });
    const feed = new DhanMarketFeed({
      url: `${this.#feedUrl}?${query.toString()}`,
      factory: this.#webSocket,
      instruments: this.#instruments,
      options: this.#options.feed,
    });
    await feed.start(ctx.signal);
    return feed;
  }

  /** One order-update WebSocket per account (`orderFeedScope: "account"`), logged in with the account's token. */
  async connectOrderFeed(ctx: AccountCallContext): Promise<OrderFeed> {
    const clientId = clientIdOf(ctx.creds);
    const feed = new DhanOrderFeed({
      url: this.#orderUpdateUrl,
      factory: this.#webSocket,
      instruments: this.#instruments,
      login: {
        LoginReq: { MsgCode: 42, ClientId: clientId, Token: ctx.creds.accessToken.reveal() },
        UserType: "SELF",
      },
      now: this.#now,
      options: this.#options.feed,
    });
    await feed.start(ctx.signal);
    return feed;
  }

  // Helpers --------------------------------------------------------------------------------------------------------------

  #rejected(message: string, code: string): BrokerRejectedError {
    return new BrokerRejectedError(message, { broker: BROKER, operation: "exchangeToken", brokerError: { code } });
  }

  #ref(key: InstrumentKey, operation: DhanRequest["operation"]): DhanInstrumentRef {
    const ref = this.#instruments.get(key);
    if (ref === undefined) {
      throw new BrokerNotFoundError(`${key} is not in the Dhan instrument map; sync the instrument master`, {
        broker: BROKER,
        operation,
      });
    }
    return ref;
  }

  #request(request: DhanRequest): Promise<unknown> {
    return dhanRequest(this.#fetch, this.#baseUrl, request);
  }

  #get(ctx: AccountCallContext, url: string, operation: DhanRequest["operation"]): Promise<unknown> {
    return this.#request({ method: "GET", url, operation, signal: ctx.signal, token: ctx.creds.accessToken.reveal() });
  }

  #send(
    ctx: AccountCallContext,
    method: "POST" | "PUT" | "DELETE",
    url: string,
    operation: DhanRequest["operation"],
    body?: unknown,
  ): Promise<unknown> {
    return this.#request({
      method,
      url,
      operation,
      signal: ctx.signal,
      token: ctx.creds.accessToken.reveal(),
      ...(body === undefined ? {} : { body }),
    });
  }
}
