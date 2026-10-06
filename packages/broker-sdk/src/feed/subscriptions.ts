/**
 * A feed's current subscription set (plan B12): key → mode, capped at the broker's `maxFeedInstruments`. Feeds use it
 * to answer `subscriptions()`, to compute what to send on subscribe/unsubscribe, and to re-subscribe everything after
 * a reconnect.
 */
import type { InstrumentKey } from "@finlytics/shared";

import { BrokerRejectedError } from "../errors";
import type { BrokerErrorOptions } from "../errors";
import type { FeedMode } from "../models";

export class FeedSubscriptions {
  readonly #modes = new Map<InstrumentKey, FeedMode>();

  /**
   * @param capacity the broker's `maxFeedInstruments`
   * @param errorOptions context for the capacity error (broker code)
   */
  constructor(
    readonly capacity: number,
    private readonly errorOptions: BrokerErrorOptions = {},
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer");
  }

  get size(): number {
    return this.#modes.size;
  }

  /**
   * Records `keys` at `mode` and returns the keys whose mode is new or changed (what to send to the broker).
   *
   * @throws {BrokerRejectedError} when the new set would exceed the capacity; nothing is recorded then.
   */
  add(keys: readonly InstrumentKey[], mode: FeedMode): InstrumentKey[] {
    const changed = [...new Set(keys)].filter((key) => this.#modes.get(key) !== mode);
    const added = changed.filter((key) => !this.#modes.has(key)).length;
    if (this.#modes.size + added > this.capacity) {
      throw new BrokerRejectedError(`A feed connection carries at most ${String(this.capacity)} instruments`, {
        ...this.errorOptions,
        brokerError: { code: "FEED_CAPACITY" },
      });
    }
    for (const key of changed) this.#modes.set(key, mode);
    return changed;
  }

  /** Forgets `keys` and returns the ones that were subscribed (what to send to the broker). */
  remove(keys: readonly InstrumentKey[]): InstrumentKey[] {
    return [...new Set(keys)].filter((key) => this.#modes.delete(key));
  }

  has(key: InstrumentKey): boolean {
    return this.#modes.has(key);
  }

  /** A snapshot of the set. */
  snapshot(): ReadonlyMap<InstrumentKey, FeedMode> {
    return new Map(this.#modes);
  }

  /** The keys grouped by mode: one subscribe request per mode after a reconnect. */
  byMode(): Map<FeedMode, InstrumentKey[]> {
    const groups = new Map<FeedMode, InstrumentKey[]>();
    for (const [key, mode] of this.#modes) {
      const group = groups.get(mode);
      if (group === undefined) groups.set(mode, [key]);
      else group.push(key);
    }
    return groups;
  }

  clear(): void {
    this.#modes.clear();
  }
}
