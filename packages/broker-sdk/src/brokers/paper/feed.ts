/**
 * Paper feeds (plan B13). The market feed mirrors a real one: ticks for subscribed keys from the quote source, a
 * snapshot tick on subscribe, the broker's capacity limit. The order feed carries the paper engine's order and trade
 * events for every paper account (app scope).
 */
import type { InstrumentKey } from "@finlytics/shared";

import { BrokerUnavailableError } from "../../errors";
import { TypedEmitter } from "../../feed/emitter";
import type { Unsubscribe } from "../../feed/emitter";
import type { FeedStatus, MarketFeed, MarketFeedEvents, OrderFeed, OrderFeedEvents } from "../../feed/feed";
import { FeedSubscriptions } from "../../feed/subscriptions";
import type { FeedMode, Tick } from "../../models";

import type { PaperQuote, PaperQuoteSource } from "./quotes";

function toTick(key: InstrumentKey, quote: PaperQuote, now: () => Date): Tick {
  return {
    instrumentKey: key,
    ltp: quote.ltp,
    ts: quote.ts ?? now().getTime(),
    ...(quote.bid === undefined ? {} : { bid: quote.bid }),
    ...(quote.ask === undefined ? {} : { ask: quote.ask }),
  };
}

export class PaperMarketFeed implements MarketFeed {
  readonly #events = new TypedEmitter<MarketFeedEvents>();
  readonly #subscriptions: FeedSubscriptions;
  readonly #stopQuotes: Unsubscribe;
  #status: FeedStatus = "up";

  constructor(
    private readonly quotes: PaperQuoteSource,
    capacity: number,
    private readonly now: () => Date,
  ) {
    this.#subscriptions = new FeedSubscriptions(capacity, { broker: "PAPER" });
    this.#stopQuotes = quotes.subscribe((key, quote) => {
      if (this.#status !== "closed" && this.#subscriptions.has(key)) this.#events.emit("tick", toTick(key, quote, now));
    });
  }

  get status(): FeedStatus {
    return this.#status;
  }

  async subscribe(keys: readonly InstrumentKey[], mode: FeedMode): Promise<void> {
    this.#assertOpen();
    const added = this.#subscriptions.add(keys, mode);
    for (const key of added) {
      const quote = await this.quotes.getQuote(key);
      if (quote !== undefined && this.#subscriptions.has(key)) this.#events.emit("tick", toTick(key, quote, this.now));
    }
  }

  /** Unknown keys, and calls on a closed feed, are no-ops. */
  unsubscribe(keys: readonly InstrumentKey[]): Promise<void> {
    this.#subscriptions.remove(keys);
    return Promise.resolve();
  }

  subscriptions(): ReadonlyMap<InstrumentKey, FeedMode> {
    return this.#subscriptions.snapshot();
  }

  on<E extends keyof MarketFeedEvents>(event: E, listener: (payload: MarketFeedEvents[E]) => void): Unsubscribe {
    return this.#events.on(event, listener);
  }

  close(): Promise<void> {
    if (this.#status !== "closed") {
      this.#status = "closed";
      this.#stopQuotes();
      this.#subscriptions.clear();
      this.#events.emit("status", "closed");
      this.#events.removeAllListeners();
    }
    return Promise.resolve();
  }

  #assertOpen(): void {
    if (this.#status === "closed") throw new BrokerUnavailableError("The feed is closed", { broker: "PAPER" });
  }
}

export class PaperOrderFeed implements OrderFeed {
  readonly #events = new TypedEmitter<OrderFeedEvents>();
  #status: FeedStatus = "up";

  /** @param onClose detaches the feed from the adapter */
  constructor(private readonly onClose: (feed: PaperOrderFeed) => void) {}

  get status(): FeedStatus {
    return this.#status;
  }

  on<E extends keyof OrderFeedEvents>(event: E, listener: (payload: OrderFeedEvents[E]) => void): Unsubscribe {
    return this.#events.on(event, listener);
  }

  /** Called by the adapter for each engine event (and matching errors). */
  publish<E extends "order" | "trade" | "error">(event: E, payload: OrderFeedEvents[E]): void {
    if (this.#status !== "closed") this.#events.emit(event, payload);
  }

  close(): Promise<void> {
    if (this.#status !== "closed") {
      this.#status = "closed";
      this.onClose(this);
      this.#events.emit("status", "closed");
      this.#events.removeAllListeners();
    }
    return Promise.resolve();
  }
}
