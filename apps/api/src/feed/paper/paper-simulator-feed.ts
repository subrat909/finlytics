/**
 * The paper market feed (phase 1 plan P2): a {@link MarketFeed} that simulates ticks for its subscribed instruments,
 * so the platform runs end to end with no broker. Each subscribed key gets a snapshot tick on subscribe, then one tick
 * every `tickMs` while its exchange is open (or always, with `alwaysOn`, the development default).
 *
 * Ticks carry the day's open/high/low, volume, the last traded quantity and, for tradable instruments (not indices),
 * the average traded price, the top of book and a simulated five-level book with its totals (whatever the mode), so
 * depth panels work without a broker.
 */
import { FeedSubscriptions, TypedEmitter } from "@finlytics/broker-sdk";
import type { FeedMode, FeedStatus, MarketFeed, MarketFeedEvents, Tick, Unsubscribe } from "@finlytics/broker-sdk";
import type { InstrumentKey } from "@finlytics/shared";

import { isMarketOpen } from "../market-hours";

import { exchangeOf, hashString, mulberry32, paperBook, PriceWalk } from "./price-model";

export interface PaperSimulatorOptions {
  readonly seed: number;
  readonly tickMs: number;
  /** Tick outside market hours too. */
  readonly alwaysOn: boolean;
  /** At most this many instruments (default 5000, like a broker connection). */
  readonly capacity?: number;
  readonly now?: () => number;
}

export class PaperSimulatorFeed implements MarketFeed {
  readonly #events = new TypedEmitter<MarketFeedEvents>();
  readonly #subscriptions: FeedSubscriptions;
  readonly #walks = new Map<InstrumentKey, PriceWalk>();
  readonly #books = new Map<InstrumentKey, () => number>();
  readonly #timer: NodeJS.Timeout;
  readonly #now: () => number;
  #status: FeedStatus = "up";

  constructor(private readonly options: PaperSimulatorOptions) {
    this.#subscriptions = new FeedSubscriptions(options.capacity ?? 5_000, { broker: "PAPER" });
    this.#now = options.now ?? Date.now;
    this.#timer = setInterval(() => {
      this.#tickAll();
    }, options.tickMs);
    this.#timer.unref();
  }

  get status(): FeedStatus {
    return this.#status;
  }

  subscribe(keys: readonly InstrumentKey[], mode: FeedMode): Promise<void> {
    if (this.#status === "closed") return Promise.reject(new Error("The paper feed is closed"));
    const added = this.#subscriptions.add(keys, mode);
    for (const key of added) {
      let walk = this.#walks.get(key);
      if (walk === undefined) {
        walk = new PriceWalk(key, this.options.seed);
        this.#walks.set(key, walk);
      }
      this.#emitTick(key, walk);
    }
    return Promise.resolve();
  }

  unsubscribe(keys: readonly InstrumentKey[]): Promise<void> {
    for (const key of this.#subscriptions.remove(keys)) {
      this.#walks.delete(key);
      this.#books.delete(key);
    }
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
      clearInterval(this.#timer);
      this.#status = "closed";
      this.#subscriptions.clear();
      this.#walks.clear();
      this.#books.clear();
      this.#events.emit("status", "closed");
      this.#events.removeAllListeners();
    }
    return Promise.resolve();
  }

  #tickAll(): void {
    const now = this.#now();
    for (const [key, walk] of this.#walks) {
      if (!this.options.alwaysOn && !isMarketOpen(exchangeOf(key), now)) continue;
      walk.step();
      this.#emitTick(key, walk);
    }
  }

  #emitTick(key: InstrumentKey, walk: PriceWalk): void {
    const tick: Tick = {
      instrumentKey: key,
      ltp: walk.ltp,
      ts: this.#now(),
      close: walk.close,
      open: walk.open,
      high: walk.high,
      low: walk.low,
      volume: walk.volume,
      ...(walk.ltq > 0 ? { ltq: walk.ltq } : {}),
      ...this.#book(key, walk),
    };
    this.#events.emit("tick", tick);
  }

  /** ATP, the top of book and a five-level book with its totals, for tradable instruments. */
  #book(key: InstrumentKey, walk: PriceWalk): Partial<Tick> {
    if (key.split("|")[0]?.endsWith("_INDEX") === true) return {};
    let random = this.#books.get(key);
    if (random === undefined) {
      random = mulberry32(hashString(`${String(this.options.seed)}:${key}:book`));
      this.#books.set(key, random);
    }
    const book = paperBook(walk.ltp, random);
    const [bid, ask] = [book.bids[0], book.asks[0]];
    return {
      ...(walk.atp === undefined ? {} : { atp: walk.atp }),
      ...(bid === undefined ? {} : { bid: bid.price, bidQty: bid.qty }),
      ...(ask === undefined ? {} : { ask: ask.price, askQty: ask.qty }),
      depth: { bids: book.bids, asks: book.asks },
      tbq: book.bids.reduce((sum, level) => sum + level.qty, 0),
      tsq: book.asks.reduce((sum, level) => sum + level.qty, 0),
    };
  }
}
