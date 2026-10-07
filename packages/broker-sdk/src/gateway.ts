/**
 * BrokerGateway: the only way into a broker (plan B11; docs/04 §3). One gateway wraps one adapter, and every call goes
 *
 *   validate input → circuit breaker → rate limiter → timeout (AbortSignal) → adapter → validate output
 *   → map to a typed BrokerError, redact secrets → log (no secrets, no payloads)
 *
 * Retries: only read operations, only on retryable errors, with backoff + jitter (plan B10). A state-changing call
 * (`placeOrder`, `modifyOrder`, `cancelOrder`, token calls) is never retried; when it fails without a definitive
 * answer the error has `outcomeUnknown`, and the caller reconciles through `getOrderBook` (the order's `tag`).
 *
 * Feeds: the gateway owns ONE market feed per broker and one order feed per broker (or per account when the adapter's
 * `orderFeedScope` is `account`), and hands the same object to every caller.
 */
import { isInstrumentKey } from "@finlytics/shared";
import type { BrokerCode } from "@finlytics/shared";
import { z } from "zod";

import { BROKER_METHODS, MUTATING_METHODS, RETRYABLE_METHODS } from "./adapter";
import type { BrokerAdapter, BrokerMethod } from "./adapter";
import type { CircuitPermit } from "./circuit-breaker";
import { CircuitBreakerRegistry } from "./circuit-breaker";
import { isSecret, secretValues } from "./credentials";
import type { BrokerCredentials } from "./credentials";
import { BrokerInputError, BrokerInternalError, BrokerTimeoutError, isBrokerError, isBrokerFailure } from "./errors";
import type { BrokerError } from "./errors";
import { backoffDelayMs } from "./feed/backoff";
import type { MarketFeed, OrderFeed } from "./feed/feed";
import {
  AuthStartSchema,
  BrokerHoldingSchema,
  BrokerIdSchema,
  BrokerOrderSchema,
  BrokerPositionSchema,
  CandleSchema,
  FundsSchema,
  InstrumentRowSchema,
  ModifyOrderInputSchema,
  PlaceOrderInputSchema,
  PlaceOrderResultSchema,
  ProfileSchema,
  TimeframeSchema,
} from "./models";
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
} from "./models";
import { rateClassOf } from "./rate-limit/limits";
import type { RateClass } from "./rate-limit/limits";
import { APP_ACCOUNT_ID } from "./rate-limit/rate-limiter";
import type { RateLimiter } from "./rate-limit/rate-limiter";
import { redactSecrets } from "./redact";
import { abortReason, DEFAULT_BROKER_TIMEOUT_MS, sleep, withTimeout } from "./timeout";

/** A connected broker account: our `BrokerAccount.id` and its decrypted credentials. */
export interface BrokerAccountRef {
  readonly accountId: string;
  readonly creds: BrokerCredentials;
}

export interface GatewayCallOptions {
  /** The caller's cancellation (request aborted, shutdown). */
  readonly signal?: AbortSignal | undefined;
}

/** Structured logging, pino-compatible (`logger.warn(fields, message)`). Fields never contain secrets or payloads. */
export interface BrokerLogger {
  debug(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface RetryOptions {
  /** Extra attempts for read operations (default 2). */
  readonly retries?: number | undefined;
  readonly baseMs?: number | undefined;
  /** The longest wait between attempts (default 2 s); a longer `retryAfterMs` ends the retries. */
  readonly maxMs?: number | undefined;
}

export interface BrokerGatewayOptions {
  readonly adapter: BrokerAdapter;
  readonly rateLimiter: RateLimiter;
  /** Shared across gateways when one process runs several (default: a registry of its own). */
  readonly breakers?: CircuitBreakerRegistry | undefined;
  /** Per-method timeouts (default 5 s; instrument master 120 s; feed connects 10 s). */
  readonly timeoutsMs?: Partial<Record<BrokerMethod, number>> | undefined;
  /** How long a call may wait for a rate-limit token (default orders 1 s, data 5 s, standard 2 s). */
  readonly rateLimitMaxWaitMs?: Partial<Record<RateClass, number>> | undefined;
  readonly retry?: RetryOptions | undefined;
  readonly logger?: BrokerLogger | undefined;
  /** Random source for retry jitter. */
  readonly random?: (() => number) | undefined;
  /** Waits between retries. */
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  /** Milliseconds clock for durations. */
  readonly now?: (() => number) | undefined;
}

const DEFAULT_TIMEOUTS_MS: Partial<Record<BrokerMethod, number>> = Object.freeze({
  downloadInstrumentMaster: 120_000,
  connectMarketFeed: 10_000,
  connectOrderFeed: 10_000,
});

const DEFAULT_MAX_WAIT_MS: Readonly<Record<RateClass, number>> = Object.freeze({
  orders: 1_000,
  data: 5_000,
  standard: 2_000,
});

const NO_LOGGER: BrokerLogger = Object.freeze({
  debug: () => undefined,
  warn: () => undefined,
});

/** Validates adapter output; a mismatch is the adapter's bug (INTERNAL), and the message never echoes the data. */
function parser<T>(schema: z.ZodType<T>, what: string): (raw: unknown) => T {
  return (raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new BrokerInternalError(`Adapter returned an invalid ${what}`);
    return parsed.data;
  };
}

const parseProfile = parser(ProfileSchema, "profile");
const parseFunds = parser(FundsSchema, "funds");
const parsePlaceResult = parser(PlaceOrderResultSchema, "order placement result");
const parseOrders = parser(z.array(BrokerOrderSchema), "order book");
const parsePositions = parser(z.array(BrokerPositionSchema), "position list");
const parseHoldings = parser(z.array(BrokerHoldingSchema), "holding list");
const parseCandles = parser(
  z
    .array(CandleSchema)
    .refine(
      (candles) => candles.every((candle, index) => index === 0 || (candles[index - 1]?.ts ?? 0) < candle.ts),
      "candles must be in strictly ascending time order",
    ),
  "candle list",
);
const parseAuthStart = parser(AuthStartSchema, "auth start");
const parseVoid = (): void => undefined;

function parseCredentials(raw: unknown): BrokerCredentials {
  const creds = raw as Partial<BrokerCredentials> | null;
  const ok =
    typeof creds === "object" &&
    creds !== null &&
    isSecret(creds.accessToken) &&
    (creds.refreshToken === undefined || isSecret(creds.refreshToken)) &&
    (creds.expiresAt === undefined || (creds.expiresAt instanceof Date && !Number.isNaN(creds.expiresAt.getTime())));
  if (!ok) throw new BrokerInternalError("Adapter returned invalid credentials");
  return creds as BrokerCredentials;
}

/** Input validation: a BrokerInputError listing `path: message` (our own schema messages, never the values). */
function validate<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new BrokerInputError(redactSecrets(`Invalid ${what}: ${issues.join("; ")}`));
}

/** Rejects with the signal's reason as soon as it aborts. */
async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  // Once the signal wins, nobody awaits `promise`; its late rejection must not become unhandled.
  promise.catch(() => undefined);
  if (signal.aborted) throw abortReason(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

interface CallScope {
  readonly accountId: string;
  readonly creds?: BrokerCredentials | undefined;
}

export class BrokerGateway {
  readonly broker: BrokerCode;
  readonly #adapter: BrokerAdapter;
  readonly #rateLimiter: RateLimiter;
  readonly #breakers: CircuitBreakerRegistry;
  readonly #timeouts: Partial<Record<BrokerMethod, number>>;
  readonly #maxWait: Readonly<Record<RateClass, number>>;
  readonly #retries: number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #logger: BrokerLogger;
  readonly #random: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => number;
  #marketFeed: Promise<MarketFeed> | undefined;
  readonly #orderFeeds = new Map<string, Promise<OrderFeed>>();

  constructor(options: BrokerGatewayOptions) {
    this.#adapter = options.adapter;
    this.broker = options.adapter.code;
    this.#rateLimiter = options.rateLimiter;
    this.#breakers = options.breakers ?? new CircuitBreakerRegistry();
    this.#timeouts = { ...DEFAULT_TIMEOUTS_MS, ...options.timeoutsMs };
    this.#maxWait = { ...DEFAULT_MAX_WAIT_MS, ...options.rateLimitMaxWaitMs };
    this.#retries = options.retry?.retries ?? 2;
    this.#retryBaseMs = options.retry?.baseMs ?? 200;
    this.#retryMaxMs = options.retry?.maxMs ?? 2_000;
    this.#logger = options.logger ?? NO_LOGGER;
    this.#random = options.random ?? Math.random;
    this.#sleep = options.sleep ?? sleep;
    this.#now = options.now ?? Date.now;
  }

  /** The adapter's fixed facts (auth mode, feed capacity). */
  get capabilities(): BrokerAdapter["capabilities"] {
    return this.#adapter.capabilities;
  }

  // 1. -----------------------------------------------------------------------------------------------------------------

  /** How the user connects. No network call, so no limiter or breaker. */
  getAuthUrl(input: { readonly state: string; readonly redirectUri: string }): AuthStart {
    try {
      return parseAuthStart(this.#adapter.getAuthUrl(input));
    } catch (error: unknown) {
      throw this.#mapError(error, "getAuthUrl", [], false);
    }
  }

  /** Turns the OAuth code (or pasted fields) into credentials. Never retried: an auth code works once. */
  exchangeToken(input: ExchangeTokenInput, options: GatewayCallOptions = {}): Promise<BrokerCredentials> {
    const secrets = [input.code, ...Object.values(input.fields ?? {})].filter((value) => value !== undefined);
    return this.#call(
      "exchangeToken",
      { accountId: APP_ACCOUNT_ID },
      options,
      parseCredentials,
      (signal) => this.#adapter.exchangeToken({ signal }, input),
      secrets,
    );
  }

  // 2–4. ---------------------------------------------------------------------------------------------------------------

  refreshToken(account: BrokerAccountRef, options: GatewayCallOptions = {}): Promise<BrokerCredentials> {
    return this.#call("refreshToken", account, options, parseCredentials, (signal) =>
      this.#adapter.refreshToken({ signal, creds: account.creds }),
    );
  }

  getProfile(account: BrokerAccountRef, options: GatewayCallOptions = {}): Promise<Profile> {
    return this.#call("getProfile", account, options, parseProfile, (signal) =>
      this.#adapter.getProfile({ signal, creds: account.creds }),
    );
  }

  getFunds(account: BrokerAccountRef, options: GatewayCallOptions = {}): Promise<Funds> {
    return this.#call("getFunds", account, options, parseFunds, (signal) =>
      this.#adapter.getFunds({ signal, creds: account.creds }),
    );
  }

  // 5. -----------------------------------------------------------------------------------------------------------------

  /**
   * Streams the instrument master. Rows that fail {@link InstrumentRowSchema} are skipped and counted in the log,
   * never yielded. The whole download shares one timeout (default 120 s). Breaking out early is fine.
   */
  async *downloadInstrumentMaster(
    options: GatewayCallOptions & { readonly creds?: BrokerCredentials | undefined } = {},
  ): AsyncGenerator<InstrumentRow, void, undefined> {
    const method = "downloadInstrumentMaster";
    const scope: CallScope = { accountId: APP_ACCOUNT_ID, creds: options.creds };
    const secrets = secretValues(options.creds);
    const permit = await this.#admit(method, scope, options.signal, secrets);
    const timeoutMs = this.#timeoutOf(method);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new BrokerTimeoutError(`Timed out after ${String(timeoutMs)} ms`, this.#context(method)));
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort(abortReason(options.signal));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const started = this.#now();
    let outcome: keyof CircuitPermit = "release";
    let completed = false;
    let rows = 0;
    let skipped = 0;
    let iterator: AsyncIterator<InstrumentRow> | undefined;
    try {
      iterator = this.#adapter
        .downloadInstrumentMaster({ signal: controller.signal, creds: options.creds })
        [Symbol.asyncIterator]();
      for (;;) {
        const next = await raceAbort(iterator.next(), controller.signal);
        if (next.done === true) break;
        const parsed = InstrumentRowSchema.safeParse(next.value);
        if (!parsed.success) {
          skipped += 1;
          continue;
        }
        rows += 1;
        yield parsed.data;
      }
      completed = true;
      outcome = "success";
    } catch (error: unknown) {
      if (options.signal?.aborted === true) throw abortReason(options.signal);
      const mapped = this.#mapError(error, method, secrets, true);
      outcome = isBrokerFailure(mapped) ? "failure" : "success";
      this.#log(method, scope, started, mapped);
      throw mapped;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      permit[outcome]();
      // Stopped early (error, abort, or the consumer broke out): let the adapter close its stream.
      if (!completed) void iterator?.return?.().catch(() => undefined);
      else this.#logger.debug({ ...this.#fields(method, scope, started), rows, skipped }, "broker call succeeded");
    }
  }

  // 6–9. ---------------------------------------------------------------------------------------------------------------

  /**
   * Places an order. Never retried. A failure with `outcomeUnknown` (timeout, lost connection, unreadable answer) may
   * have placed it: reconcile through {@link getOrderBook} using the order's `tag` before trying again.
   */
  async placeOrder(
    account: BrokerAccountRef,
    input: PlaceOrderInput,
    options: GatewayCallOptions = {},
  ): Promise<PlaceOrderResult> {
    const order = validate(PlaceOrderInputSchema, input, "order");
    return await this.#call("placeOrder", account, options, parsePlaceResult, (signal) =>
      this.#adapter.placeOrder({ signal, creds: account.creds }, order),
    );
  }

  /** Modifies an open order. Never retried. */
  async modifyOrder(
    account: BrokerAccountRef,
    input: ModifyOrderInput,
    options: GatewayCallOptions = {},
  ): Promise<void> {
    const change = validate(ModifyOrderInputSchema, input, "order change");
    await this.#call("modifyOrder", account, options, parseVoid, (signal) =>
      this.#adapter.modifyOrder({ signal, creds: account.creds }, change),
    );
  }

  /** Cancels an open order. Never retried. */
  async cancelOrder(account: BrokerAccountRef, brokerOrderId: string, options: GatewayCallOptions = {}): Promise<void> {
    const id = validate(BrokerIdSchema, brokerOrderId, "order id");
    await this.#call("cancelOrder", account, options, parseVoid, (signal) =>
      this.#adapter.cancelOrder({ signal, creds: account.creds }, id),
    );
  }

  getOrderBook(account: BrokerAccountRef, options: GatewayCallOptions = {}): Promise<BrokerOrder[]> {
    return this.#call("getOrderBook", account, options, parseOrders, (signal) =>
      this.#adapter.getOrderBook({ signal, creds: account.creds }),
    );
  }

  // 10–11. -------------------------------------------------------------------------------------------------------------

  getPositions(account: BrokerAccountRef, options: GatewayCallOptions = {}): Promise<BrokerPosition[]> {
    return this.#call("getPositions", account, options, parsePositions, (signal) =>
      this.#adapter.getPositions({ signal, creds: account.creds }),
    );
  }

  getHoldings(account: BrokerAccountRef, options: GatewayCallOptions = {}): Promise<BrokerHolding[]> {
    return this.#call("getHoldings", account, options, parseHoldings, (signal) =>
      this.#adapter.getHoldings({ signal, creds: account.creds }),
    );
  }

  /** Candles in ascending time order. Callers fetch only the gaps Timescale doesn't have yet. */
  async getHistoricalCandles(
    account: BrokerAccountRef,
    query: CandleQuery,
    options: GatewayCallOptions = {},
  ): Promise<Candle[]> {
    if (!isInstrumentKey(query.instrumentKey)) throw new BrokerInputError("Invalid candle query: instrumentKey");
    validate(TimeframeSchema, query.timeframe, "candle timeframe");
    if (!(query.from.getTime() < query.to.getTime())) {
      throw new BrokerInputError("Invalid candle query: from must be before to");
    }
    return await this.#call("getHistoricalCandles", account, options, parseCandles, (signal) =>
      this.#adapter.getHistoricalCandles({ signal, creds: account.creds }, query),
    );
  }

  // 12. ----------------------------------------------------------------------------------------------------------------

  /**
   * The broker's ONE market feed. Every caller gets the same object; a new connection is made only after the
   * previous one was closed. `account` is the designated feed account (any active account of this broker).
   */
  connectMarketFeed(account: BrokerAccountRef, options: GatewayCallOptions = {}): Promise<MarketFeed> {
    const current = this.#marketFeed;
    if (current !== undefined) return this.#reuse(current, () => this.#openMarketFeed(account, options));
    return this.#openMarketFeed(account, options);
  }

  /** The broker's order feed: one per broker, or one per account when `orderFeedScope` is `account`. */
  connectOrderFeed(account: BrokerAccountRef, options: GatewayCallOptions = {}): Promise<OrderFeed> {
    const key = this.#adapter.capabilities.orderFeedScope === "app" ? APP_ACCOUNT_ID : account.accountId;
    const current = this.#orderFeeds.get(key);
    if (current !== undefined) return this.#reuse(current, () => this.#openOrderFeed(key, account, options));
    return this.#openOrderFeed(key, account, options);
  }

  /** Closes every feed this gateway opened (shutdown). */
  async close(): Promise<void> {
    const feeds: Promise<MarketFeed | OrderFeed>[] = [...this.#orderFeeds.values()];
    if (this.#marketFeed !== undefined) feeds.push(this.#marketFeed);
    this.#marketFeed = undefined;
    this.#orderFeeds.clear();
    await Promise.all(
      feeds.map(async (pending) => {
        try {
          await (await pending).close();
        } catch {
          // A feed that never connected has nothing to close.
        }
      }),
    );
  }

  async #reuse<F extends MarketFeed | OrderFeed>(pending: Promise<F>, reopen: () => Promise<F>): Promise<F> {
    let feed: F;
    try {
      feed = await pending;
    } catch {
      return reopen();
    }
    return feed.status === "closed" ? reopen() : feed;
  }

  #openMarketFeed(account: BrokerAccountRef, options: GatewayCallOptions): Promise<MarketFeed> {
    const pending = this.#call(
      "connectMarketFeed",
      account,
      options,
      (feed: MarketFeed) => feed,
      (signal) => this.#adapter.connectMarketFeed({ signal, creds: account.creds }),
    );
    this.#marketFeed = pending;
    pending.catch(() => {
      if (this.#marketFeed === pending) this.#marketFeed = undefined;
    });
    return pending;
  }

  #openOrderFeed(key: string, account: BrokerAccountRef, options: GatewayCallOptions): Promise<OrderFeed> {
    const pending = this.#call(
      "connectOrderFeed",
      account,
      options,
      (feed: OrderFeed) => feed,
      (signal) => this.#adapter.connectOrderFeed({ signal, creds: account.creds }),
    );
    this.#orderFeeds.set(key, pending);
    pending.catch(() => {
      if (this.#orderFeeds.get(key) === pending) this.#orderFeeds.delete(key);
    });
    return pending;
  }

  // Plumbing -----------------------------------------------------------------------------------------------------------

  /** One gateway call with read-only retries. */
  async #call<R, T>(
    method: BrokerMethod,
    scope: CallScope,
    options: GatewayCallOptions,
    parse: (raw: R) => T,
    run: (signal: AbortSignal) => Promise<R>,
    extraSecrets: readonly string[] = [],
  ): Promise<T> {
    const secrets = [...secretValues(scope.creds), ...extraSecrets];
    const retries = RETRYABLE_METHODS.has(method) ? this.#retries : 0;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#attempt(method, scope, options, parse, run, secrets);
      } catch (error: unknown) {
        if (attempt > retries || !isBrokerError(error) || !error.retryable || options.signal?.aborted === true) {
          throw error;
        }
        const delay =
          error.retryAfterMs ??
          backoffDelayMs(attempt, { baseMs: this.#retryBaseMs, maxMs: this.#retryMaxMs, random: this.#random });
        if (delay > this.#retryMaxMs) throw error;
        await this.#sleep(delay, options.signal);
      }
    }
  }

  /** Breaker permit, then a rate-limit token. Throws mapped errors; releases the permit when no token comes. */
  async #admit(
    method: BrokerMethod,
    scope: CallScope,
    signal: AbortSignal | undefined,
    secrets: readonly string[],
  ): Promise<CircuitPermit> {
    let permit: CircuitPermit;
    try {
      permit = this.#breakers.get(this.broker, scope.accountId).acquire();
    } catch (error: unknown) {
      throw this.#mapError(error, method, secrets, false);
    }
    const rateClass = rateClassOf(method);
    try {
      await this.#rateLimiter.acquire(
        { broker: this.broker, accountId: scope.accountId, rateClass },
        { maxWaitMs: this.#maxWait[rateClass], signal },
      );
    } catch (error: unknown) {
      permit.release();
      if (signal?.aborted === true) throw abortReason(signal);
      throw this.#mapError(error, method, secrets, false);
    }
    return permit;
  }

  async #attempt<R, T>(
    method: BrokerMethod,
    scope: CallScope,
    options: GatewayCallOptions,
    parse: (raw: R) => T,
    run: (signal: AbortSignal) => Promise<R>,
    secrets: readonly string[],
  ): Promise<T> {
    const permit = await this.#admit(method, scope, options.signal, secrets);
    const started = this.#now();
    try {
      const raw = await withTimeout(run, {
        timeoutMs: this.#timeoutOf(method),
        signal: options.signal,
        error: this.#context(method),
      });
      const value = parse(raw);
      permit.success();
      this.#logger.debug(this.#fields(method, scope, started), "broker call succeeded");
      return value;
    } catch (error: unknown) {
      if (options.signal?.aborted === true) {
        permit.release();
        throw abortReason(options.signal);
      }
      const mapped = this.#mapError(error, method, secrets, true);
      if (isBrokerFailure(mapped)) permit.failure();
      else permit.success();
      this.#log(method, scope, started, mapped);
      throw mapped;
    }
  }

  #timeoutOf(method: BrokerMethod): number {
    return this.#timeouts[method] ?? DEFAULT_BROKER_TIMEOUT_MS;
  }

  #context(method: BrokerMethod): { broker: BrokerCode; operation: BrokerMethod; outcomeUnknown: boolean } {
    return { broker: this.broker, operation: method, outcomeUnknown: MUTATING_METHODS.has(method) };
  }

  /**
   * Any thrown value → a typed, redacted BrokerError with broker and operation set. `sent`: the request may have
   * reached the broker, so an unavailable/internal failure of a mutating call has an unknown outcome.
   */
  #mapError(error: unknown, method: BrokerMethod, secrets: readonly string[], sent: boolean): BrokerError {
    const unknownOutcome = (code: string): boolean =>
      sent && MUTATING_METHODS.has(method) && (code === "BROKER_UNAVAILABLE" || code === "INTERNAL");
    if (isBrokerError(error)) {
      const detail = error.brokerError;
      return error.with({
        message: redactSecrets(error.message, secrets),
        broker: this.broker,
        operation: method,
        outcomeUnknown: error.outcomeUnknown || unknownOutcome(error.code),
        ...(detail === undefined
          ? {}
          : {
              brokerError: {
                code: redactSecrets(detail.code, secrets, 64),
                ...(detail.message === undefined ? {} : { message: redactSecrets(detail.message, secrets) }),
              },
            }),
      });
    }
    const description = error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
    return new BrokerInternalError(redactSecrets(`Unexpected adapter error (${description})`, secrets), {
      broker: this.broker,
      operation: method,
      outcomeUnknown: unknownOutcome("INTERNAL"),
    });
  }

  #fields(method: BrokerMethod, scope: CallScope, started: number): Record<string, unknown> {
    return {
      broker: this.broker,
      accountId: scope.accountId,
      operation: method,
      op: BROKER_METHODS[method],
      durationMs: this.#now() - started,
    };
  }

  #log(method: BrokerMethod, scope: CallScope, started: number, error: BrokerError): void {
    this.#logger.warn(
      {
        ...this.#fields(method, scope, started),
        code: error.code,
        error: error.name,
        brokerCode: error.brokerError?.code,
        outcomeUnknown: error.outcomeUnknown,
        message: error.message,
      },
      "broker call failed",
    );
  }
}
