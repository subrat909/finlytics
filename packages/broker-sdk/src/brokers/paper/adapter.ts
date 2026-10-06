/**
 * PaperAdapter: the built-in paper broker (plan B13). Implements the full BrokerAdapter contract in memory, with no
 * network: fills come from an injected quote source, so results are deterministic for a given quote sequence.
 *
 * Quirks (documented like a real broker's):
 * - Auth: `getAuthUrl` is `{ mode: "none" }`; `exchangeToken` opens a new paper account (client id `PAPER-…`) and
 *   returns a random token. Tokens never expire; `refreshToken` returns the same credentials. A known client id with
 *   the wrong token, or credentials without a client id, is NEEDS_RELOGIN. An unknown client id (after a restart: state
 *   is per process) opens that account again, empty.
 * - Rate limits: none of its own; the gateway still applies the PAPER budget (100/s).
 * - Order ids `PAPER-<instance>-<n>`, trade ids `PT-<instance>-<n>`; `newId` replaces them (tests).
 * - Holdings are a static list from the options (no T+1 settlement of DELIVERY buys yet).
 * - Historical candles come from an optional source; without one the answer is an empty list.
 * - One app-scoped order feed: every paper account's order and trade events, with `brokerClientId`.
 *
 * State changes are serialised through one internal queue, so concurrent calls and quote updates apply in order.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { EXCHANGES, toDecimal } from "@finlytics/shared";
import type { DecimalLike, InstrumentKey } from "@finlytics/shared";

import type { AccountCallContext, BrokerAdapter, BrokerCapabilities, CallContext } from "../../adapter";
import { Secret } from "../../credentials";
import type { BrokerCredentials } from "../../credentials";
import { NeedsReloginError } from "../../errors";
import type { MarketFeed, OrderFeed } from "../../feed/feed";
import type {
  AuthStart,
  BrokerHolding,
  BrokerOrder,
  BrokerPosition,
  Candle,
  CandleQuery,
  Funds,
  InstrumentRow,
  ModifyOrderInput,
  PlaceOrderInput,
  PlaceOrderResult,
  Profile,
} from "../../models";

import { zeroCharges } from "./charges";
import type { PaperChargesFn } from "./charges";
import { PaperAccount } from "./engine";
import type { PaperEvent } from "./engine";
import { PaperMarketFeed, PaperOrderFeed } from "./feed";
import type { PaperQuote, PaperQuoteSource } from "./quotes";

export interface PaperAdapterOptions {
  /** Where prices come from (MemoryQuoteSource in tests; Redis-backed in 2.x). */
  readonly quotes: PaperQuoteSource;
  /** Starting cash per account (default 10,00,000). */
  readonly initialCash?: DecimalLike | undefined;
  /** Charges per fill (default: none). */
  readonly charges?: PaperChargesFn | undefined;
  /** Caps each fill, so orders fill over several quotes (default: fill everything at once). */
  readonly maxFillQtyPerMatch?: number | undefined;
  /** The instrument master `downloadInstrumentMaster` yields; also enables lot, freeze and tick checks. */
  readonly instruments?: readonly InstrumentRow[] | undefined;
  /** Holdings every paper account reports. */
  readonly holdings?: readonly BrokerHolding[] | undefined;
  /** Candles for `getHistoricalCandles`. */
  readonly candles?: ((query: CandleQuery) => Candle[] | Promise<Candle[]>) | undefined;
  /** Display name in the profile (default "Paper trader"). */
  readonly name?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly newId?: ((kind: "order" | "trade") => string) | undefined;
}

export const PAPER_CAPABILITIES: BrokerCapabilities = Object.freeze({
  authMode: "none",
  refreshable: true,
  maxFeedInstruments: 5_000,
  orderFeedScope: "app",
});

export class PaperAdapter implements BrokerAdapter {
  readonly code = "PAPER";
  readonly capabilities = PAPER_CAPABILITIES;

  readonly #options: PaperAdapterOptions;
  readonly #accounts = new Map<string, PaperAccount>();
  readonly #orderFeeds = new Set<PaperOrderFeed>();
  readonly #instruments: ReadonlyMap<InstrumentKey, InstrumentRow>;
  readonly #now: () => Date;
  readonly #newId: (kind: "order" | "trade") => string;
  #queue: Promise<unknown> = Promise.resolve();
  #accountSeq = 0;

  constructor(options: PaperAdapterOptions) {
    const max = options.maxFillQtyPerMatch;
    if (max !== undefined && (!Number.isSafeInteger(max) || max < 1)) {
      throw new RangeError("maxFillQtyPerMatch must be a positive integer");
    }
    this.#options = options;
    this.#instruments = new Map((options.instruments ?? []).map((row) => [row.instrumentKey, row]));
    this.#now = options.now ?? (() => new Date());
    const instance = randomBytes(3).toString("hex");
    let seq = 0;
    this.#newId =
      options.newId ??
      ((kind) => {
        seq += 1;
        return `${kind === "order" ? "PAPER" : "PT"}-${instance}-${String(seq)}`;
      });
    options.quotes.subscribe((key, quote) => {
      this.#exclusive(() => {
        for (const account of this.#accounts.values()) this.#publish(account, account.onQuote(key, quote));
      }).catch((error: unknown) => {
        // A failing charges function, for example: report it on the order feeds rather than lose it.
        for (const feed of this.#orderFeeds) feed.publish("error", error);
      });
    });
  }

  // 1–2. ---------------------------------------------------------------------------------------------------------------

  getAuthUrl(): AuthStart {
    return { mode: "none" };
  }

  exchangeToken(ctx: CallContext): Promise<BrokerCredentials> {
    return this.#exclusive(() => {
      ctx.signal.throwIfAborted();
      this.#accountSeq += 1;
      const clientId = `PAPER-${randomBytes(4).toString("hex").toUpperCase()}${String(this.#accountSeq)}`;
      const token = randomUUID();
      this.#accounts.set(clientId, this.#newAccount(clientId, token));
      return { accessToken: Secret.of(token), clientId };
    });
  }

  refreshToken(ctx: AccountCallContext): Promise<BrokerCredentials> {
    return this.#withAccount(ctx, () => ctx.creds);
  }

  // 3–4. ---------------------------------------------------------------------------------------------------------------

  getProfile(ctx: AccountCallContext): Promise<Profile> {
    return this.#withAccount(ctx, (account) => ({
      brokerClientId: account.clientId,
      name: this.#options.name ?? "Paper trader",
      exchanges: [...EXCHANGES],
    }));
  }

  getFunds(ctx: AccountCallContext): Promise<Funds> {
    return this.#withAccount(ctx, (account) => account.funds());
  }

  // 5. -----------------------------------------------------------------------------------------------------------------

  async *downloadInstrumentMaster(ctx: CallContext): AsyncIterable<InstrumentRow> {
    for (const row of this.#instruments.values()) {
      ctx.signal.throwIfAborted();
      yield await Promise.resolve(row);
    }
  }

  // 6–9. ---------------------------------------------------------------------------------------------------------------

  placeOrder(ctx: AccountCallContext, input: PlaceOrderInput): Promise<PlaceOrderResult> {
    return this.#withAccount(ctx, async (account) => {
      const { brokerOrderId, events } = account.place(input, await this.#quote(input.instrumentKey));
      this.#publish(account, events);
      return { brokerOrderId };
    });
  }

  modifyOrder(ctx: AccountCallContext, input: ModifyOrderInput): Promise<void> {
    return this.#withAccount(ctx, async (account) => {
      const order = account.orders().find((candidate) => candidate.brokerOrderId === input.brokerOrderId);
      const quote = order === undefined ? undefined : await this.#quote(order.instrumentKey);
      this.#publish(account, account.modify(input, quote));
    });
  }

  cancelOrder(ctx: AccountCallContext, brokerOrderId: string): Promise<void> {
    return this.#withAccount(ctx, (account) => {
      this.#publish(account, account.cancel(brokerOrderId));
    });
  }

  getOrderBook(ctx: AccountCallContext): Promise<BrokerOrder[]> {
    return this.#withAccount(ctx, (account) => account.orders());
  }

  // 10–11. -------------------------------------------------------------------------------------------------------------

  getPositions(ctx: AccountCallContext): Promise<BrokerPosition[]> {
    return this.#withAccount(ctx, async (account) => {
      const ltps = new Map<InstrumentKey, string>();
      for (const position of account.positions(() => undefined)) {
        const quote = await this.#quote(position.instrumentKey);
        if (quote !== undefined) ltps.set(position.instrumentKey, quote.ltp);
      }
      return account.positions((key) => ltps.get(key));
    });
  }

  getHoldings(ctx: AccountCallContext): Promise<BrokerHolding[]> {
    return this.#withAccount(ctx, () => [...(this.#options.holdings ?? [])]);
  }

  getHistoricalCandles(ctx: AccountCallContext, query: CandleQuery): Promise<Candle[]> {
    return this.#withAccount(ctx, async () => (await this.#options.candles?.(query)) ?? []);
  }

  // 12. ----------------------------------------------------------------------------------------------------------------

  connectMarketFeed(ctx: AccountCallContext): Promise<MarketFeed> {
    return this.#withAccount(
      ctx,
      () => new PaperMarketFeed(this.#options.quotes, this.capabilities.maxFeedInstruments, this.#now),
    );
  }

  connectOrderFeed(ctx: AccountCallContext): Promise<OrderFeed> {
    return this.#withAccount(ctx, () => {
      const feed = new PaperOrderFeed((closed) => this.#orderFeeds.delete(closed));
      this.#orderFeeds.add(feed);
      return feed;
    });
  }

  // Plumbing -----------------------------------------------------------------------------------------------------------

  #newAccount(clientId: string, token: string): PaperAccount {
    return new PaperAccount(clientId, token, {
      initialCash: toDecimal(this.#options.initialCash ?? "1000000"),
      charges: this.#options.charges ?? zeroCharges,
      maxFillQtyPerMatch: this.#options.maxFillQtyPerMatch,
      instruments: this.#instruments,
      newId: this.#newId,
      now: this.#now,
    });
  }

  /** Runs `fn` after every earlier state change, in order. */
  #exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.#queue.then(fn);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** Authenticates the credentials, then runs `fn` on the account, serialised. */
  #withAccount<T>(ctx: AccountCallContext, fn: (account: PaperAccount) => T | Promise<T>): Promise<T> {
    return this.#exclusive(() => {
      ctx.signal.throwIfAborted();
      const { clientId } = ctx.creds;
      if (clientId === undefined) throw new NeedsReloginError("Paper credentials have no client id");
      let account = this.#accounts.get(clientId);
      if (account === undefined) {
        account = this.#newAccount(clientId, ctx.creds.accessToken.reveal());
        this.#accounts.set(clientId, account);
      } else if (account.token !== ctx.creds.accessToken.reveal()) {
        throw new NeedsReloginError("Paper session is not valid");
      }
      return fn(account);
    });
  }

  async #quote(key: InstrumentKey): Promise<PaperQuote | undefined> {
    return this.#options.quotes.getQuote(key);
  }

  #publish(account: PaperAccount, events: readonly PaperEvent[]): void {
    for (const event of events) {
      for (const feed of this.#orderFeeds) {
        if (event.kind === "order") feed.publish("order", { brokerClientId: account.clientId, order: event.order });
        else feed.publish("trade", { brokerClientId: account.clientId, trade: event.trade });
      }
    }
  }
}
