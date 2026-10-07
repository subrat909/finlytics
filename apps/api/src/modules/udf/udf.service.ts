/**
 * The TradingView UDF datafeed (phase 1 plan "REST", https://www.tradingview.com/charting-library-docs/latest/
 * connecting_data/UDF): config, server time, symbol info, search and history, in UDF's JSON shapes. Symbols are
 * canonical instrument keys (every search result's `ticker`); history comes from CandlesService, so it shares the
 * Timescale store and the one-time backfill with `GET /v1/candles`.
 */
import {
  CANDLE_TIMEFRAME_MS,
  EXCHANGES,
  MAX_CANDLES_PER_REQUEST,
  SEGMENTS,
  toDecimal,
  UDF_RESOLUTIONS,
  UDF_SUPPORTED_RESOLUTIONS,
} from "@finlytics/shared";
import type {
  Exchange,
  InstrumentKey,
  Segment,
  UdfConfig,
  UdfHistory,
  UdfHistoryQuery,
  UdfSearchQuery,
  UdfSearchResult,
  UdfSymbolInfo,
} from "@finlytics/shared";
import { Inject, Injectable } from "@nestjs/common";

import { CLOCK } from "../../common/clock";
import type { Clock } from "../../common/clock";
import { NotFoundError } from "../../common/problem-json/domain-errors";
import { SESSIONS } from "../../feed/market-hours";
import { CandlesService } from "../candles/candles.service";

import { UdfRepository } from "./udf.repository";
import type { UdfInstrumentRow } from "./udf.repository";

/** UDF symbol types per segment. */
const SYMBOL_TYPES: Readonly<Record<Segment, string>> = Object.freeze({
  EQ: "stock",
  INDEX: "index",
  FUT: "futures",
  OPT: "option",
});

const INTRADAY_MULTIPLIERS = Object.freeze(["1", "5", "15", "60"]);

/** Wall-clock time per trading time for intraday bars (6.25 h sessions, 5 days a week), to size a `countback` range. */
const INTRADAY_SPAN_FACTOR = (24 / 6.25) * (7 / 5);

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}${String(minutes % 60).padStart(2, "0")}`;
}

/** `minmov` and `pricescale` for a tick size: 0.05 → 5 / 100. */
export function priceFormat(tickSize: { toFixed(): string }): { minmov: number; pricescale: number } {
  const tick = toDecimal(tickSize);
  const decimals = tick.decimalPlaces();
  const pricescale = 10 ** decimals;
  const minmov = tick.times(pricescale).toNumber();
  return Number.isInteger(minmov) && minmov >= 1 ? { minmov, pricescale } : { minmov: 1, pricescale: 100 };
}

export function symbolInfo(row: UdfInstrumentRow): UdfSymbolInfo {
  const session = SESSIONS[row.exchange];
  return {
    name: row.symbol,
    ticker: row.key,
    description: row.name,
    type: SYMBOL_TYPES[row.segment],
    session: `${hhmm(session.openMin)}-${hhmm(session.closeMin)}`,
    timezone: "Asia/Kolkata",
    exchange: row.exchange,
    listed_exchange: row.exchange,
    ...priceFormat(row.tickSize),
    has_intraday: true,
    has_daily: true,
    supported_resolutions: [...UDF_SUPPORTED_RESOLUTIONS],
    intraday_multipliers: [...INTRADAY_MULTIPLIERS],
    volume_precision: 0,
    data_status: "streaming",
  };
}

@Injectable()
export class UdfService {
  constructor(
    private readonly instruments: UdfRepository,
    private readonly candles: CandlesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  config(): UdfConfig {
    return {
      supported_resolutions: [...UDF_SUPPORTED_RESOLUTIONS],
      supports_group_request: false,
      supports_marks: false,
      supports_search: true,
      supports_timescale_marks: false,
      supports_time: true,
      exchanges: [
        { value: "", name: "All exchanges", desc: "" },
        ...EXCHANGES.map((code) => ({ value: code, name: code, desc: code })),
      ],
      symbols_types: [
        { name: "All types", value: "" },
        ...SEGMENTS.map((segment) => ({ name: SYMBOL_TYPES[segment], value: SYMBOL_TYPES[segment] })),
      ],
    };
  }

  /** Server time, epoch seconds. */
  time(): number {
    return Math.floor(this.clock.now().getTime() / 1_000);
  }

  async symbol(key: InstrumentKey): Promise<UdfSymbolInfo> {
    const row = await this.instruments.findActive(key);
    if (row === null) throw new NotFoundError("Unknown symbol.");
    return symbolInfo(row);
  }

  async search(query: UdfSearchQuery): Promise<UdfSearchResult> {
    const exchange = (EXCHANGES as readonly string[]).includes(query.exchange ?? "")
      ? (query.exchange as Exchange)
      : undefined;
    const segment = SEGMENTS.find((candidate) => SYMBOL_TYPES[candidate] === query.type);
    const rows = await this.instruments.search(query.query, query.limit, { exchange, segment });
    return rows.map((row) => ({
      symbol: row.symbol,
      full_name: `${row.exchange}:${row.key}`,
      description: row.name,
      exchange: row.exchange,
      ticker: row.key,
      type: SYMBOL_TYPES[row.segment],
    }));
  }

  async history(userId: string, query: UdfHistoryQuery): Promise<UdfHistory> {
    const timeframe = UDF_RESOLUTIONS[query.resolution];
    const barMs = CANDLE_TIMEFRAME_MS[timeframe];
    const to = query.to * 1_000;
    let from = query.from * 1_000;
    if (query.countback !== undefined) {
      const span = query.countback * barMs * (timeframe === "D1" ? 7 / 5 : INTRADAY_SPAN_FACTOR);
      from = Math.min(from, to - Math.ceil(span));
    }
    from = Math.max(from, to - MAX_CANDLES_PER_REQUEST * barMs, 0);
    if (from >= to) return { s: "no_data" };
    let bars = await this.candles.list(userId, {
      key: query.symbol,
      tf: timeframe,
      from: new Date(from),
      to: new Date(to),
    });
    if (query.countback !== undefined) bars = bars.slice(-query.countback);
    if (bars.length === 0) return { s: "no_data" };
    return {
      s: "ok",
      t: bars.map((bar) => Math.floor(bar.ts / 1_000)),
      o: bars.map((bar) => Number(bar.open)),
      h: bars.map((bar) => Number(bar.high)),
      l: bars.map((bar) => Number(bar.low)),
      c: bars.map((bar) => Number(bar.close)),
      v: bars.map((bar) => bar.volume),
    };
  }
}
