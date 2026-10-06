/**
 * `GET /v1/quotes` (docs/04 §2 "Market data"): the latest quotes from Redis, never from a broker (broker.md: quotes
 * come from the shared market feed). Keys without a quote are left out; a malformed hash is skipped.
 */
import type { QuotesQuery, QuotesResult } from "@finlytics/shared";
import { quoteFromHash } from "@finlytics/shared";
import { Injectable } from "@nestjs/common";

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
}
