/**
 * UpstoxAdapter: Upstox API v2 (REST) + Market Data Feed V3 + the portfolio stream, behind the 12-operation contract
 * (broker.md). Built from the official docs (https://upstox.com/developer/api-documentation/, read 2026-10-06); wire
 * types in ./types.ts.
 *
 * Rate limits (per API, per user; https://upstox.com/developer/api-documentation/rate-limiting/):
 * - Orders (place, modify, cancel, multi, GTT combined): 10/s for algos not registered with SEBI (50/s registered),
 *   500/min, 2000/30 min. The gateway's UPSTOX `orders` bucket admits ≤ 10/s (8/s, burst 3).
 * - Everything else (profile, funds, order book, positions, holdings, candles, feed authorize): 50/s, 500/min,
 *   2000/30 min. broker.md caps us at 25/s. The per-minute and per-30-minute windows are not enforced locally: Upstox
 *   answers 429 / `UDAPI10005`, which becomes RateLimitedError. Exceeding them "might result in temporary suspension".
 * - Market feed: 2 WebSocket connections per user (5 with Upstox Plus); per-mode key limits per user (ltpc 5000,
 *   option_greeks 3000, full 2000; when modes are mixed 2000/2000/1500), exposed as `capabilities.feedLimits`. We use
 *   ONE market connection per platform and one portfolio stream per account, so a user's second connection stays free.
 *
 * Quirks:
 * - Auth: OAuth2 code flow, no refresh token. Every token dies at 03:30 IST (the next day, or the same day for logins
 *   between 00:00 and 03:30): `refreshToken` is NEEDS_RELOGIN and `expiresAt` is set precisely. `extended_token` is
 *   ignored (read-only). Users bring their own Upstox app: its API key/secret come in `getAuthUrl({ apiKey })` and
 *   `exchangeToken({ fields: { apiKey, apiSecret } })` (and go back in `creds.extra` for the vault), else the
 *   platform app from the options.
 * - Funds: one figure since 19 July 2025 (`equity` holds equity + commodity); no collateral figure (reported as 0).
 *   The funds service and the order APIs are down 00:00–05:30 IST (`UDAPI100072`/`UDAPI100074` → unavailable).
 * - Products: Upstox `D` is delivery for equity and carry-forward for F&O, so MARGIN maps to `D` on FUT/OPT and `MTF`
 *   on equity; CO/BO can't be placed. MARKET orders get the exchange's default market protection (-1).
 * - Orders go through v2 (one order id) and are never auto-sliced: a quantity above the freeze quantity is refused
 *   before the call, as are quantities off the lot size and prices off the tick size (Upstox's `tick_size` is in
 *   paise; the master converts it). Modify needs order type, validity, price and trigger price: missing ones are read
 *   from the order book (operation 9's endpoint, no 13th endpoint).
 * - Order times are IST without an offset ("2023-10-19 09:23:23"). Status texts are lower case with spaces; unknown
 *   ones map to PENDING so the order is reconciled again. Rows whose instrument isn't in the resolver are skipped.
 * - Instruments: Upstox keys (`NSE_FO|52618`, `NSE_EQ|<ISIN>`) ↔ canonical keys through an injected
 *   {@link UpstoxInstrumentResolver} (the api's `InstrumentBrokerToken` table). The master asset needs no auth.
 * - Candles: V3 historical (whole days before today, in windows of ≤ 28 days up to 15-minute bars, ≤ 89 days up to
 *   hourly, ≤ 10 years daily; minutes and hours exist from January 2022, days from January 2000, so earlier days are
 *   never asked for) + V3 intraday for today; newest first on the wire, ascending here.
 * - Positions and holdings carry `last_price` and `close_price` (previous close). An equity row whose `instrument_token`
 *   (`NSE_EQ|<ISIN>`) the resolver doesn't know yet maps through its trading symbol (`NHPC-EQ` → `NSE_EQ|NHPC`), so
 *   holdings show before the instrument master is synced; derivatives need the master.
 * - Feed ticks: `cp` is the previous close, `marketOHLC` interval `1d` the day's OHLC (indices too, in `indexFF`),
 *   `vtt` the day's volume, `tbq`/`tsq` the book totals; proto3 zeros ("none yet") are left out of the tick.
 * - Feeds: the authorize endpoints return single-use `wss://` URLs, so every reconnect authorizes again (one standard
 *   request). Feed requests are JSON in BINARY frames; responses are protobuf `FeedResponse` (./proto.ts).
 */
import { randomUUID } from "node:crypto";

import { isOnTick } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";
import { z } from "zod";

import type { AccountCallContext, BrokerAdapter, BrokerCapabilities, BrokerMethod, CallContext } from "../../adapter";
import { Secret } from "../../credentials";
import type { BrokerCredentials } from "../../credentials";
import { BrokerInputError, BrokerNotFoundError, BrokerRejectedError, NeedsReloginError } from "../../errors";
import type { BackoffOptions } from "../../feed/backoff";
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

import {
  nativeUpstoxSocket,
  UPSTOX_MAX_FEED_INSTRUMENTS,
  UPSTOX_SDK_FEED_LIMITS,
  UpstoxMarketFeed,
  UpstoxOrderFeed,
} from "./feed";
import type { UpstoxSocketFactory } from "./feed";
import { upstoxCall, upstoxError, upstoxSend } from "./http";
import type { UpstoxCallContext, UpstoxFetch } from "./http";
import { UpstoxInstrumentMap, upstoxInstrumentRows } from "./instruments";
import type { UpstoxInstrumentRef, UpstoxInstrumentResolver } from "./instruments";
import {
  candleSpec,
  decimalString,
  fallbackEquityKey,
  fromUpstoxOrderType,
  fromUpstoxValidity,
  istDate,
  segmentOf,
  toBrokerOrder,
  toCandle,
  toFunds,
  toHolding,
  toPosition,
  toProfile,
  toUpstoxOrderType,
  toUpstoxProduct,
  upstoxTokenExpiry,
} from "./mappers";
import {
  UPSTOX_URLS,
  UpstoxCandlesSchema,
  UpstoxFeedAuthorizeSchema,
  UpstoxFundsSchema,
  UpstoxHoldingSchema,
  UpstoxOrderIdSchema,
  UpstoxOrderSchema,
  UpstoxPositionSchema,
  UpstoxProfileSchema,
  UpstoxTokenResponseSchema,
} from "./types";
import type { UpstoxCandle, UpstoxModifyOrderRequest, UpstoxPlaceOrderRequest } from "./types";

/** An Upstox app: the API key is OAuth's `client_id`, the secret its `client_secret`. */
export interface UpstoxAppCredentials {
  readonly apiKey: Secret;
  readonly apiSecret: Secret;
}

export interface UpstoxAdapterOptions {
  /** The platform's Upstox app, used when a call doesn't bring the user's own. */
  readonly appCredentials?: UpstoxAppCredentials | undefined;
  /** Canonical ↔ Upstox keys (default: an empty in-memory map, so instrument calls fail as unknown). */
  readonly instruments?: UpstoxInstrumentResolver | undefined;
  /** Default: Node's global fetch. */
  readonly fetch?: UpstoxFetch | undefined;
  /** Default: Node's global WebSocket. */
  readonly webSocket?: UpstoxSocketFactory | undefined;
  readonly now?: (() => Date) | undefined;
  /** Market feed request ids (default: random UUIDs). */
  readonly newGuid?: (() => string) | undefined;
  readonly feed?:
    | {
        readonly backoff?: BackoffOptions | undefined;
        readonly heartbeatMs?: number | undefined;
        readonly quietHeartbeatMs?: number | undefined;
      }
    | undefined;
}

/** `getAuthUrl`'s input, plus the user's own Upstox API key when they registered their app. */
export interface UpstoxAuthUrlInput {
  readonly state: string;
  readonly redirectUri: string;
  readonly apiKey?: string | undefined;
}

export const UPSTOX_CAPABILITIES: BrokerCapabilities = Object.freeze({
  authMode: "oauth",
  refreshable: false,
  maxFeedInstruments: UPSTOX_MAX_FEED_INSTRUMENTS,
  // Per user, so per connection: full ≤ 2000 alone, 1500 next to ltp (≤ 2000).
  feedLimits: UPSTOX_SDK_FEED_LIMITS,
  // The portfolio stream carries one access token's orders.
  orderFeedScope: "account",
});

const RowsSchema = z.array(z.unknown());
const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Rows that pass `schema`; a row Upstox changed shape on is skipped, not fatal. */
function validRows<T>(rows: readonly unknown[], schema: z.ZodType<T>): T[] {
  const valid: T[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
}

function needsPrice(type: string): boolean {
  return type === "LIMIT" || type === "SL";
}

function needsTrigger(type: string): boolean {
  return type === "SL" || type === "SL_M";
}

export class UpstoxAdapter implements BrokerAdapter {
  readonly code = "UPSTOX";
  readonly capabilities = UPSTOX_CAPABILITIES;

  readonly #options: UpstoxAdapterOptions;
  readonly #instruments: UpstoxInstrumentResolver;
  readonly #fetch: UpstoxFetch;
  readonly #socketFactory: UpstoxSocketFactory;
  readonly #now: () => Date;

  constructor(options: UpstoxAdapterOptions = {}) {
    this.#options = options;
    this.#instruments = options.instruments ?? new UpstoxInstrumentMap();
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#socketFactory = options.webSocket ?? nativeUpstoxSocket;
    this.#now = options.now ?? (() => new Date());
  }

  // 1–2. ---------------------------------------------------------------------------------------------------------------

  getAuthUrl(input: UpstoxAuthUrlInput): AuthStart {
    const apiKey = input.apiKey ?? this.#options.appCredentials?.apiKey.reveal();
    if (apiKey === undefined || apiKey === "") {
      throw this.#invalid("getAuthUrl", "An Upstox API key is needed to start the login", "API_KEY");
    }
    const url = new URL(UPSTOX_URLS.authorize);
    url.searchParams.set("client_id", apiKey);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", input.state);
    return { mode: "oauth", url: url.toString() };
  }

  async exchangeToken(ctx: CallContext, input: ExchangeTokenInput): Promise<BrokerCredentials> {
    const own = input.fields?.apiKey;
    const app =
      own === undefined
        ? this.#options.appCredentials && {
            apiKey: this.#options.appCredentials.apiKey.reveal(),
            apiSecret: this.#options.appCredentials.apiSecret.reveal(),
          }
        : { apiKey: own, apiSecret: input.fields?.apiSecret };
    const { code, redirectUri } = input;
    if (!code || !redirectUri || !app?.apiKey || !app.apiSecret) {
      throw this.#invalid(
        "exchangeToken",
        "The Upstox login needs the code, the redirect URI and the app's API key and secret",
        "INPUT",
      );
    }
    const token = await upstoxCall(
      this.#call(ctx, "exchangeToken", true),
      {
        method: "POST",
        url: UPSTOX_URLS.token,
        form: {
          code,
          client_id: app.apiKey,
          client_secret: app.apiSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        },
      },
      UpstoxTokenResponseSchema,
    );
    return {
      accessToken: Secret.of(token.access_token),
      expiresAt: upstoxTokenExpiry(this.#now()),
      clientId: token.user_id,
      ...(own === undefined ? {} : { extra: { apiKey: Secret.of(app.apiKey), apiSecret: Secret.of(app.apiSecret) } }),
    };
  }

  refreshToken(): Promise<BrokerCredentials> {
    return Promise.reject(
      new NeedsReloginError("Upstox sessions end at 03:30 IST and can't be refreshed: log in to Upstox again", {
        broker: "UPSTOX",
        operation: "refreshToken",
      }),
    );
  }

  // 3–4. ---------------------------------------------------------------------------------------------------------------

  async getProfile(ctx: AccountCallContext): Promise<Profile> {
    return toProfile(await this.#get(ctx, "getProfile", UPSTOX_URLS.profile, UpstoxProfileSchema));
  }

  async getFunds(ctx: AccountCallContext): Promise<Funds> {
    return toFunds(await this.#get(ctx, "getFunds", UPSTOX_URLS.funds, UpstoxFundsSchema));
  }

  // 5. -----------------------------------------------------------------------------------------------------------------

  async *downloadInstrumentMaster(ctx: CallContext): AsyncIterable<InstrumentRow> {
    const call = this.#call(ctx, "downloadInstrumentMaster");
    const response = await upstoxSend(call, { method: "GET", url: UPSTOX_URLS.instrumentMaster });
    if (!response.ok) throw upstoxError(call, response, undefined);
    yield* upstoxInstrumentRows(response.body, ctx.signal);
  }

  // 6–9. ---------------------------------------------------------------------------------------------------------------

  async placeOrder(ctx: AccountCallContext, input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const ref = await this.#instrument("placeOrder", input.instrumentKey);
    const product = toUpstoxProduct(input.product, segmentOf(input.instrumentKey));
    if (product === undefined) {
      throw this.#invalid("placeOrder", `Upstox orders can't use the ${input.product} product`, "PRODUCT");
    }
    this.#checkOrder(ref, input.qty, [input.price, input.triggerPrice]);
    const body: UpstoxPlaceOrderRequest = {
      quantity: input.qty,
      product,
      validity: input.validity,
      price: Number(input.price ?? 0),
      ...(input.tag === undefined ? {} : { tag: input.tag }),
      instrument_token: ref.brokerToken,
      order_type: toUpstoxOrderType(input.type),
      transaction_type: input.side,
      disclosed_quantity: 0,
      trigger_price: Number(input.triggerPrice ?? 0),
      is_amo: false,
    };
    const data = await upstoxCall(
      this.#call(ctx, "placeOrder", true),
      { method: "POST", url: UPSTOX_URLS.placeOrder, token: ctx.creds.accessToken, json: body },
      UpstoxOrderIdSchema,
    );
    return { brokerOrderId: data.order_id };
  }

  async modifyOrder(ctx: AccountCallContext, input: ModifyOrderInput): Promise<void> {
    let { type, validity, price, triggerPrice } = input;
    if (
      type === undefined ||
      validity === undefined ||
      (needsPrice(type) && price === undefined) ||
      (needsTrigger(type) && triggerPrice === undefined)
    ) {
      // Upstox's modify needs every one of them: take the missing ones from the order as it stands.
      const current = await this.#currentOrder(ctx, input.brokerOrderId);
      type ??= current.type;
      validity ??= current.validity;
      price ??= current.price;
      triggerPrice ??= current.triggerPrice;
    }
    const body: UpstoxModifyOrderRequest = {
      order_id: input.brokerOrderId,
      ...(input.qty === undefined ? {} : { quantity: input.qty }),
      validity,
      price: needsPrice(type) ? Number(price ?? 0) : 0,
      order_type: toUpstoxOrderType(type),
      trigger_price: needsTrigger(type) ? Number(triggerPrice ?? 0) : 0,
    };
    await upstoxCall(
      this.#call(ctx, "modifyOrder", true),
      { method: "PUT", url: UPSTOX_URLS.modifyOrder, token: ctx.creds.accessToken, json: body },
      UpstoxOrderIdSchema,
    );
  }

  async cancelOrder(ctx: AccountCallContext, brokerOrderId: string): Promise<void> {
    const url = new URL(UPSTOX_URLS.cancelOrder);
    url.searchParams.set("order_id", brokerOrderId);
    await upstoxCall(
      this.#call(ctx, "cancelOrder", true),
      { method: "DELETE", url: url.toString(), token: ctx.creds.accessToken },
      UpstoxOrderIdSchema,
    );
  }

  async getOrderBook(ctx: AccountCallContext): Promise<BrokerOrder[]> {
    const rows = validRows(await this.#get(ctx, "getOrderBook", UPSTOX_URLS.orderBook, RowsSchema), UpstoxOrderSchema);
    const keys = await this.#keysOf(rows);
    const now = this.#now();
    return rows.flatMap((row) => {
      const key = keys.get(row.instrument_token);
      const order = key === undefined ? undefined : toBrokerOrder(row, key, now);
      return order === undefined ? [] : [order];
    });
  }

  // 10–11. -------------------------------------------------------------------------------------------------------------

  async getPositions(ctx: AccountCallContext): Promise<BrokerPosition[]> {
    const rows = validRows(
      await this.#get(ctx, "getPositions", UPSTOX_URLS.positions, RowsSchema),
      UpstoxPositionSchema,
    );
    const keys = await this.#keysOf(rows);
    return rows.flatMap((row) => {
      const key = keys.get(row.instrument_token);
      const position = key === undefined ? undefined : toPosition(row, key);
      return position === undefined ? [] : [position];
    });
  }

  async getHoldings(ctx: AccountCallContext): Promise<BrokerHolding[]> {
    const rows = validRows(await this.#get(ctx, "getHoldings", UPSTOX_URLS.holdings, RowsSchema), UpstoxHoldingSchema);
    const keys = await this.#keysOf(rows);
    return rows.flatMap((row) => {
      const key = keys.get(row.instrument_token);
      return key === undefined ? [] : [toHolding(row, key)];
    });
  }

  async getHistoricalCandles(ctx: AccountCallContext, query: CandleQuery): Promise<Candle[]> {
    const ref = await this.#instrument("getHistoricalCandles", query.instrumentKey);
    const spec = candleSpec(query.timeframe);
    const path = `${encodeURIComponent(ref.brokerToken)}/${spec.unit}/${String(spec.interval)}`;
    const from = query.from.getTime();
    const to = query.to.getTime();
    const today = istDate(this.#now().getTime());
    const toDate = istDate(to);
    const lastHistorical = toDate < today ? toDate : addDays(today, -1);
    const raw: UpstoxCandle[] = [];
    const first = istDate(from) < spec.since ? spec.since : istDate(from);
    for (let start = first; start <= lastHistorical;) {
      const window = addDays(start, spec.maxDays - 1);
      const end = window < lastHistorical ? window : lastHistorical;
      const url = `${UPSTOX_URLS.historicalCandles}/${path}/${end}/${start}`;
      raw.push(...(await this.#get(ctx, "getHistoricalCandles", url, UpstoxCandlesSchema)).candles);
      start = addDays(end, 1);
    }
    if (toDate >= today && from <= to) {
      const url = `${UPSTOX_URLS.intradayCandles}/${path}`;
      raw.push(...(await this.#get(ctx, "getHistoricalCandles", url, UpstoxCandlesSchema)).candles);
    }
    const segment = segmentOf(query.instrumentKey);
    const byTs = new Map<number, Candle>();
    for (const entry of raw) {
      const candle = toCandle(entry, segment === "FUT" || segment === "OPT");
      if (candle !== undefined && candle.ts + spec.ms > from && candle.ts <= to) byTs.set(candle.ts, candle);
    }
    return [...byTs.values()].sort((a, b) => a.ts - b.ts);
  }

  // 12. ----------------------------------------------------------------------------------------------------------------

  connectMarketFeed(ctx: AccountCallContext): Promise<MarketFeed> {
    const feed = this.#options.feed;
    return UpstoxMarketFeed.open(
      {
        authorize: (signal) =>
          this.#authorizeFeed({ signal, creds: ctx.creds }, "connectMarketFeed", UPSTOX_URLS.marketFeedAuthorize),
        socketFactory: this.#socketFactory,
        resolver: this.#instruments,
        newGuid: this.#options.newGuid ?? randomUUID,
        backoff: feed?.backoff,
        heartbeatMs: feed?.heartbeatMs,
        quietHeartbeatMs: feed?.quietHeartbeatMs,
      },
      ctx.signal,
    );
  }

  connectOrderFeed(ctx: AccountCallContext): Promise<OrderFeed> {
    const url = new URL(UPSTOX_URLS.portfolioFeedAuthorize);
    url.searchParams.set("update_types", "order");
    return UpstoxOrderFeed.open(
      {
        authorize: (signal) => this.#authorizeFeed({ signal, creds: ctx.creds }, "connectOrderFeed", url.toString()),
        socketFactory: this.#socketFactory,
        resolver: this.#instruments,
        now: this.#now,
        backoff: this.#options.feed?.backoff,
      },
      ctx.signal,
    );
  }

  // Plumbing -----------------------------------------------------------------------------------------------------------

  #call(ctx: CallContext, operation: BrokerMethod, mutating = false): UpstoxCallContext {
    return { fetch: this.#fetch, signal: ctx.signal, operation, mutating };
  }

  #get<S extends z.ZodType>(
    ctx: AccountCallContext,
    operation: BrokerMethod,
    url: string,
    schema: S,
  ): Promise<z.infer<S>> {
    return upstoxCall(this.#call(ctx, operation), { method: "GET", url, token: ctx.creds.accessToken }, schema);
  }

  #authorizeFeed(ctx: AccountCallContext, operation: BrokerMethod, url: string): Promise<string> {
    return this.#get(ctx, operation, url, UpstoxFeedAuthorizeSchema);
  }

  /** Canonical keys for rows' Upstox tokens: the resolver's, else an equity key from the row's trading symbol. */
  async #keysOf(
    rows: readonly {
      readonly instrument_token: string;
      readonly trading_symbol?: string | null | undefined;
      readonly tradingsymbol?: string | null | undefined;
    }[],
  ): Promise<ReadonlyMap<string, InstrumentKey>> {
    const keys = new Map(await this.#instruments.byTokens(rows.map((row) => row.instrument_token)));
    for (const row of rows) {
      if (keys.has(row.instrument_token)) continue;
      const key = fallbackEquityKey(row.instrument_token, row.trading_symbol ?? row.tradingsymbol);
      if (key !== undefined) keys.set(row.instrument_token, key);
    }
    return keys;
  }

  #invalid(operation: BrokerMethod, message: string, code: string): BrokerInputError {
    return new BrokerInputError(message, { broker: "UPSTOX", operation, brokerError: { code } });
  }

  async #instrument(operation: BrokerMethod, key: InstrumentKey): Promise<UpstoxInstrumentRef> {
    const ref = (await this.#instruments.byKeys([key])).get(key);
    if (ref === undefined) throw this.#invalid(operation, `Upstox has no instrument for ${key}`, "UNKNOWN_INSTRUMENT");
    return ref;
  }

  /** The lot, freeze and tick checks Upstox's RMS would otherwise reject the order for. */
  #checkOrder(ref: UpstoxInstrumentRef, qty: number, prices: readonly (string | undefined)[]): void {
    const { lotSize, freezeQty, tickSize } = ref;
    if (lotSize !== undefined && qty % lotSize !== 0) {
      throw this.#invalid(
        "placeOrder",
        `The quantity must be a multiple of the lot size ${String(lotSize)}`,
        "LOT_SIZE",
      );
    }
    if (freezeQty !== undefined && qty > freezeQty) {
      throw this.#invalid(
        "placeOrder",
        `The quantity is above the freeze quantity ${String(freezeQty)}: split the order`,
        "FREEZE_QTY",
      );
    }
    for (const price of prices) {
      if (tickSize !== undefined && price !== undefined && !isOnTick(price, tickSize)) {
        throw this.#invalid("placeOrder", `The price must be a multiple of the tick size ${tickSize}`, "TICK_SIZE");
      }
    }
  }

  /** Type, validity, price and trigger of an order as it stands, from the order book. */
  async #currentOrder(
    ctx: AccountCallContext,
    brokerOrderId: string,
  ): Promise<Pick<BrokerOrder, "type" | "validity" | "price" | "triggerPrice">> {
    const rows = validRows(await this.#get(ctx, "modifyOrder", UPSTOX_URLS.orderBook, RowsSchema), UpstoxOrderSchema);
    const row = rows.find((candidate) => candidate.order_id === brokerOrderId);
    if (row === undefined) {
      throw new BrokerNotFoundError("Upstox does not know this order", {
        broker: "UPSTOX",
        operation: "modifyOrder",
        brokerError: { code: "ORDER_NOT_FOUND" },
      });
    }
    const type = fromUpstoxOrderType(row.order_type);
    const validity = fromUpstoxValidity(row.validity);
    if (type === undefined || validity === undefined) {
      throw new BrokerRejectedError("This Upstox order can't be modified here", {
        broker: "UPSTOX",
        operation: "modifyOrder",
        brokerError: { code: "UNSUPPORTED_ORDER" },
      });
    }
    return {
      type,
      validity,
      ...(row.price ? { price: decimalString(row.price) } : {}),
      ...(row.trigger_price ? { triggerPrice: decimalString(row.trigger_price) } : {}),
    };
  }
}
