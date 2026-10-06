/**
 * Where the paper broker gets prices (plan B13). In production (2.x) a source backed by Redis `quote:<key>` and the
 * `q:<key>` channel implements {@link PaperQuoteSource}; tests and local runs use {@link MemoryQuoteSource}.
 */
import { PriceSchema } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";

import type { Unsubscribe } from "../../feed/emitter";

/** The prices a paper fill needs: LTP, and the top of book when known. Decimal strings. */
export interface PaperQuote {
  readonly ltp: string;
  readonly bid?: string | undefined;
  readonly ask?: string | undefined;
  /** Exchange timestamp, epoch milliseconds. */
  readonly ts?: number | undefined;
}

export interface PaperQuoteSource {
  getQuote(key: InstrumentKey): PaperQuote | undefined | Promise<PaperQuote | undefined>;
  /** Called on every new quote; resting paper orders re-match on it. */
  subscribe(listener: (key: InstrumentKey, quote: PaperQuote) => void): Unsubscribe;
}

/** Quotes held in memory; `set` notifies subscribers synchronously. */
export class MemoryQuoteSource implements PaperQuoteSource {
  readonly #quotes = new Map<InstrumentKey, PaperQuote>();
  readonly #listeners = new Set<(key: InstrumentKey, quote: PaperQuote) => void>();

  /**
   * Stores a quote and notifies subscribers.
   *
   * @throws {TypeError} when a price isn't a non-negative decimal string.
   */
  set(key: InstrumentKey, quote: PaperQuote): void {
    for (const price of [quote.ltp, quote.bid, quote.ask]) {
      if (price !== undefined && !PriceSchema.safeParse(price).success) {
        throw new TypeError(`Invalid quote price for ${key}`);
      }
    }
    this.#quotes.set(key, quote);
    for (const listener of [...this.#listeners]) listener(key, quote);
  }

  getQuote(key: InstrumentKey): PaperQuote | undefined {
    return this.#quotes.get(key);
  }

  subscribe(listener: (key: InstrumentKey, quote: PaperQuote) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
