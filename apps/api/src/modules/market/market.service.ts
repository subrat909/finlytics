/**
 * `GET /v1/market/overview` (phase-1b "Market overview"): the footer's sessions and feed, the navbar's indices and the
 * dashboard's market panel, from our own caches only (broker.md: quotes come from the one shared feed, never a REST
 * call):
 *
 * - `exchanges`: NSE, BSE and MCX phases in IST with `MarketHoliday` (market-sessions.ts);
 * - `feed`: `feed:source` and the leader's status (`stale` when no tick for 5 s while NSE is open);
 * - `indices`: every MARKET_INDEX_KEYS entry, in that order, named from `Instrument`;
 * - `gainers`, `losers` (by change %), `active` (by volume), at most 5 each, and `breadth`, over the NIFTY 50.
 *
 * The answer is the same for every user and is built at most once a second (concurrent callers share the build).
 * Holidays and instrument names change rarely and are cached for 10 minutes.
 */
import { DecimalStringSchema, MARKET_EXCHANGES, parseInstrumentKey, PriceSchema, toDecimal } from "@finlytics/shared";
import type { FeedInfo, InstrumentKey, MarketBreadth, MarketOverview, MarketQuote } from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import { feedStateOf, FeedSourceReader } from "../../feed/feed-source";
import type { FeedSnapshot } from "../../feed/feed-source";
import { IST_OFFSET_MS, istDayStart } from "../../feed/market-hours";
import { INDEX_KEYS, PINNED_KEYS } from "../../feed/pinned-keys";

import { exchangeStatus, holidayIndex, LOOKAHEAD_DAYS } from "./market-sessions";
import type { HolidayIndex } from "./market-sessions";
import { MarketRepository } from "./market.repository";
import type { InstrumentLabel } from "./market.repository";

/** The overview is rebuilt at most this often. */
export const OVERVIEW_CACHE_MS = 1_000;
/** Holidays and instrument names are re-read this often. */
export const REFERENCE_CACHE_MS = 600_000;
/** Top movers per list. */
export const TOP_MOVERS = 5;

const DAY_MS = 86_400_000;
/** The indices, in MARKET_INDEX_KEYS order, then the NIFTY 50: the feed's pinned keys. */
const ALL_KEYS: readonly InstrumentKey[] = PINNED_KEYS;

const COUNT = /^\d{1,15}$/;

function price(value: string | undefined): string | null {
  return PriceSchema.safeParse(value).success ? (value ?? null) : null;
}

function decimal(value: string | undefined): string | null {
  return DecimalStringSchema.safeParse(value).success ? (value ?? null) : null;
}

function count(value: string | undefined): number | null {
  return value !== undefined && COUNT.test(value) ? Number(value) : null;
}

/** The key's own symbol, for an instrument the table doesn't have. */
function fallbackLabel(key: string): InstrumentLabel {
  const parsed = parseInstrumentKey(key);
  const symbol = parsed.ok ? parsed.value.symbol : key.slice(0, 64);
  return { symbol, name: symbol };
}

/** One line of the overview from a `quote:*` hash: every field null until the feed has it. */
export function marketQuote(
  key: InstrumentKey,
  label: InstrumentLabel,
  hash: Readonly<Record<string, string>>,
): MarketQuote {
  const ltp = price(hash["ltp"]);
  const ts = ltp === null ? null : count(hash["ts"]);
  const close = ltp === null ? null : price(hash["close"]);
  const known = ltp !== null && ts !== null;
  return {
    key,
    symbol: label.symbol.slice(0, 64),
    name: (label.name === "" ? label.symbol : label.name).slice(0, 200),
    ltp: known ? ltp : null,
    // Change needs the previous close: the feed writes "0" without one, which would read as "unchanged".
    chg: known && close !== null ? decimal(hash["chg"]) : null,
    chgPct: known && close !== null ? decimal(hash["chgPct"]) : null,
    open: known ? price(hash["open"]) : null,
    high: known ? price(hash["high"]) : null,
    low: known ? price(hash["low"]) : null,
    close: known ? close : null,
    vol: known ? count(hash["vol"]) : null,
    ts: known ? ts : null,
  };
}

/** Gainers, losers and most active (at most {@link TOP_MOVERS} each) and breadth over `quotes`. */
export function movers(
  quotes: readonly MarketQuote[],
): Pick<MarketOverview, "gainers" | "losers" | "active" | "breadth"> {
  const changed = quotes.filter((quote) => quote.chgPct !== null && quote.chg !== null);
  const byChange = (a: MarketQuote, b: MarketQuote): number =>
    toDecimal(b.chgPct ?? "0").comparedTo(toDecimal(a.chgPct ?? "0")) || a.key.localeCompare(b.key);
  const gainers = changed.filter((quote) => toDecimal(quote.chgPct ?? "0").gt(0)).toSorted(byChange);
  const losers = changed.filter((quote) => toDecimal(quote.chgPct ?? "0").lt(0)).toSorted((a, b) => byChange(b, a));
  const active = quotes
    .filter((quote) => (quote.vol ?? 0) > 0)
    .toSorted((a, b) => (b.vol ?? 0) - (a.vol ?? 0) || a.key.localeCompare(b.key));
  const breadth: MarketBreadth = { advances: 0, declines: 0, unchanged: 0 };
  for (const quote of changed) {
    const change = toDecimal(quote.chg ?? "0");
    if (change.gt(0)) breadth.advances += 1;
    else if (change.lt(0)) breadth.declines += 1;
    else breadth.unchanged += 1;
  }
  return {
    gainers: gainers.slice(0, TOP_MOVERS),
    losers: losers.slice(0, TOP_MOVERS),
    active: active.slice(0, TOP_MOVERS),
    breadth,
  };
}

/** The feed line: source, state (ticks expected only while NSE is open) and the last tick. */
export function feedInfo(snapshot: FeedSnapshot, now: number, expectTicks: boolean): FeedInfo {
  const lastTickAt = snapshot.status?.lastTickAt ?? null;
  return {
    state: feedStateOf(snapshot.status, now, expectTicks ? (lastTickAt ?? 0) : undefined),
    source: snapshot.source.broker,
    live: snapshot.source.live,
    lastTickAt: lastTickAt === null ? null : new Date(lastTickAt).toISOString(),
    reason: snapshot.source.reason,
  };
}

interface Cached<T> {
  readonly until: number;
  readonly value: Promise<T>;
}

@Injectable()
export class MarketService {
  #overview: Cached<MarketOverview> | undefined;
  #holidays: Cached<HolidayIndex> | undefined;
  #labels: Cached<Map<string, InstrumentLabel>> | undefined;

  constructor(
    private readonly market: MarketRepository,
    private readonly feed: FeedSourceReader,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The overview, at most a second old. */
  overview(): Promise<MarketOverview> {
    const now = this.clock.now().getTime();
    if (this.#overview !== undefined && now < this.#overview.until) return this.#overview.value;
    const value = this.#build(now);
    this.#overview = { until: now + OVERVIEW_CACHE_MS, value };
    value.catch(() => {
      if (this.#overview?.value === value) this.#overview = undefined;
    });
    return value;
  }

  async #build(now: number): Promise<MarketOverview> {
    const [holidays, labels, hashes, snapshot] = await Promise.all([
      this.#holidaysAt(now),
      this.#labelsAt(now),
      this.market.quotes(ALL_KEYS),
      this.feed.current(),
    ]);
    const exchanges = MARKET_EXCHANGES.map((exchange) => exchangeStatus(exchange, now, holidays));
    const quotes = ALL_KEYS.map((key, index) =>
      marketQuote(key, labels.get(key) ?? fallbackLabel(key), hashes[index] ?? {}),
    );
    const nseOpen = exchanges.some((status) => status.exchange === "NSE" && status.phase === "open");
    return {
      asOf: new Date(now).toISOString(),
      exchanges,
      feed: feedInfo(snapshot, now, nseOpen),
      indices: quotes.slice(0, INDEX_KEYS.length),
      ...movers(quotes.slice(INDEX_KEYS.length)),
    };
  }

  #holidaysAt(now: number): Promise<HolidayIndex> {
    if (this.#holidays !== undefined && now < this.#holidays.until) return this.#holidays.value;
    const today = istDayStart(now);
    // MarketHoliday dates are UTC midnights of IST dates: the window covers yesterday through the lookahead.
    const from = new Date(Date.UTC(...utcParts(today - DAY_MS)));
    const to = new Date(Date.UTC(...utcParts(today + (LOOKAHEAD_DAYS + 1) * DAY_MS)));
    const value = this.market.holidays(MARKET_EXCHANGES, from, to).then(holidayIndex);
    this.#holidays = { until: now + REFERENCE_CACHE_MS, value };
    value.catch(() => {
      if (this.#holidays?.value === value) this.#holidays = undefined;
    });
    return value;
  }

  #labelsAt(now: number): Promise<Map<string, InstrumentLabel>> {
    if (this.#labels !== undefined && now < this.#labels.until) return this.#labels.value;
    const value = this.market.labels(ALL_KEYS);
    this.#labels = { until: now + REFERENCE_CACHE_MS, value };
    value.catch(() => {
      if (this.#labels?.value === value) this.#labels = undefined;
    });
    return value;
  }
}

/** The IST calendar date of the IST day starting at `dayStart`, as `Date.UTC` arguments. */
function utcParts(dayStart: number): [number, number, number] {
  const date = new Date(dayStart + IST_OFFSET_MS);
  return [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
}
