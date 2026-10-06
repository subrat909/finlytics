/**
 * The paper market feed (phase 1 plan P2): a {@link MarketFeed} that simulates ticks for its subscribed instruments,
 * so the platform runs end to end with no broker. Each subscribed key gets a snapshot tick on subscribe, then one tick
 * every `tickMs` while its exchange is open (or always, with `alwaysOn`, the development default).
 */
import { FeedSubscriptions, TypedEmitter } from "@finlytics/broker-sdk";
import type { FeedMode, FeedStatus, MarketFeed, MarketFeedEvents, Tick, Unsubscribe } from "@finlytics/broker-sdk";
import type { InstrumentKey } from "@finlytics/shared";

import { isMarketOpen } from "../market-hours";

import { exchangeOf, PriceWalk } from "./price-model";

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
    for (const key of this.#subscriptions.remove(keys)) this.#walks.delete(key);
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
    };
    this.#events.emit("tick", tick);
  }
}
