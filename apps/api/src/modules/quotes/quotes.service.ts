/**
 * `GET /v1/quotes` and `GET /v1/quotes/depth` (docs/04 §2 "Market data"): the latest quotes and books from Redis, never
 * from a broker (broker.md: quotes come from the shared market feed). Keys without a quote are left out; a malformed
 * hash is skipped. A known, active instrument without a book yet (an index, or before its first full tick) answers an
 * empty book (`t: 0`); only an unknown key is a 404.
 */
import type { QuoteDepthQuery, QuotesQuery, QuotesResult, RtDepth } from "@finlytics/shared";
import { quoteFromHash } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

import { NotFoundError } from "../../common/problem-json/domain-errors";
import { decodeDepth } from "../../feed/quote-update";

import { QuotesRepository } from "./quotes.repository";

@Injectable()
export class QuotesService {
  constructor(private readonly quotes: QuotesRepository) {}

  async get(query: QuotesQuery): Promise<QuotesResult> {
    const hashes = await this.quotes.hashes(query.keys);
    const result: QuotesResult = {};
    query.keys.forEach((key, index) => {
      const quote = quoteFromHash(hashes[index] ?? {});
      if (quote !== undefined) result[key] = quote;
    });
    return result;
  }

  /** @throws {NotFoundError} when the key names no active instrument. */
  async depth(query: QuoteDepthQuery): Promise<RtDepth> {
    const depth = decodeDepth(await this.quotes.depth(query.key));
    if (depth?.k === query.key) return depth;
    if (!(await this.quotes.isActiveInstrument(query.key))) throw new NotFoundError("Instrument not found.");
    return { k: query.key, t: 0, bids: [], asks: [], tbq: null, tsq: null };
  }
}
