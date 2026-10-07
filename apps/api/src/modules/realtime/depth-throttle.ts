/**
 * Throttling for the `depth` event (phase-1b "Quotes, depth and realtime"): between two flushes only the latest book
 * per instrument is kept, and one instrument's book is sent at most once per `minIntervalMs` (250 ms: 4 a second).
 * Like the quote coalescer, a few milliseconds of timer jitter are tolerated.
 */
import type { InstrumentKey, RtDepth } from "@finlytics/shared";

/** At most 4 depth messages per second per instrument. */
export const DEPTH_MIN_INTERVAL_MS = 250;

const JITTER_MS = 10;

export class DepthThrottle {
  readonly #pending = new Map<InstrumentKey, RtDepth>();
  readonly #lastSent = new Map<InstrumentKey, number>();

  constructor(private readonly minIntervalMs = DEPTH_MIN_INTERVAL_MS) {}

  get size(): number {
    return this.#pending.size;
  }

  /** Keeps `depth` unless a newer book (by exchange time) is already waiting. */
  push(depth: RtDepth): void {
    const key = depth.k;
    const waiting = this.#pending.get(key);
    if (waiting !== undefined && waiting.t > depth.t) return;
    this.#pending.set(key, depth);
  }

  /** The books due at `now` (removed from the queue); the rest wait for a later flush. */
  drain(now: number): Map<InstrumentKey, RtDepth> {
    const due = new Map<InstrumentKey, RtDepth>();
    for (const [key, depth] of this.#pending) {
      const last = this.#lastSent.get(key);
      if (last !== undefined && now - last < this.minIntervalMs - JITTER_MS) continue;
      due.set(key, depth);
      this.#lastSent.set(key, now);
    }
    for (const key of due.keys()) this.#pending.delete(key);
    return due;
  }

  /** Marks `key` as just sent (a snapshot went out). */
  sent(key: InstrumentKey, now: number): void {
    this.#lastSent.set(key, now);
  }

  /** Drops everything about `key` (no local subscriber is left). */
  forget(key: InstrumentKey): void {
    this.#pending.delete(key);
    this.#lastSent.delete(key);
  }
}
