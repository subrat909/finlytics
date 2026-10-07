/**
 * Coalescing for the `q` event (phase 1 plan "WebSocket"): between two flushes only the latest update per instrument
 * is kept, and one instrument is sent at most once per `minIntervalMs`. The gateway flushes every 100 ms
 * (RT_COALESCE_MS), so each instrument reaches a client at most 10 times a second however fast the feed ticks.
 *
 * The interval check allows a few milliseconds of timer jitter (a 100 ms interval that fires after 98 ms must not skip
 * a whole flush); the flush cadence keeps the average at or below 10 per second.
 */
import type { InstrumentKey } from "@finlytics/shared";

import type { QuoteUpdate } from "../../feed/quote-update";

/** Timer jitter tolerated by the per-instrument interval. */
const JITTER_MS = 10;

export class TickCoalescer {
  readonly #pending = new Map<InstrumentKey, QuoteUpdate>();
  readonly #lastSent = new Map<InstrumentKey, number>();

  constructor(private readonly minIntervalMs: number) {}

  /** Instruments waiting for a flush. */
  get size(): number {
    return this.#pending.size;
  }

  /** Keeps `update` unless a newer one (by exchange time) is already waiting. */
  push(update: QuoteUpdate): void {
    const waiting = this.#pending.get(update.k);
    if (waiting !== undefined && waiting.ts > update.ts) return;
    this.#pending.set(update.k, update);
  }

  /** The updates due at `now` (removed from the queue); the rest wait for a later flush. */
  drain(now: number): Map<InstrumentKey, QuoteUpdate> {
    const due = new Map<InstrumentKey, QuoteUpdate>();
    for (const [key, update] of this.#pending) {
      const last = this.#lastSent.get(key);
      if (last !== undefined && now - last < this.minIntervalMs - JITTER_MS) continue;
      due.set(key, update);
      this.#lastSent.set(key, now);
    }
    for (const key of due.keys()) this.#pending.delete(key);
    return due;
  }

  /** Drops everything about `key` (no local subscriber is left). */
  forget(key: InstrumentKey): void {
    this.#pending.delete(key);
    this.#lastSent.delete(key);
  }
}
