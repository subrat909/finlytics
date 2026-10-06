/** Shared setup for the paper adapter tests: one NIFTY option with a quote, lot 75, tick 0.05, freeze 1800. */
import { formatInstrumentKey } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";

import type { AccountCallContext } from "../../../adapter";
import type { BrokerCredentials } from "../../../credentials";
import type { InstrumentRow, PlaceOrderInput } from "../../../models";
import { PaperAdapter } from "../adapter";
import type { PaperAdapterOptions } from "../adapter";
import { MemoryQuoteSource } from "../quotes";

export const NIFTY_CE: InstrumentKey = formatInstrumentKey({
  segment: "OPT",
  token: "NSE_FO",
  symbol: "NIFTY",
  expiry: "2025-10-30",
  strike: "24000",
  optionType: "CE",
});

export const INFY: InstrumentKey = formatInstrumentKey({ segment: "EQ", token: "NSE_EQ", symbol: "INFY" });

export const INSTRUMENTS: readonly InstrumentRow[] = [
  {
    instrumentKey: NIFTY_CE,
    brokerToken: "PAPER-NIFTY-24000-CE",
    exchange: "NFO",
    segment: "OPT",
    tradingSymbol: "NIFTY25OCT24000CE",
    name: "NIFTY 30 OCT 2025 24000 CE",
    expiry: "2025-10-30",
    strike: "24000",
    optionType: "CE",
    lotSize: 75,
    tickSize: "0.05",
    freezeQty: 1800,
  },
  {
    instrumentKey: INFY,
    brokerToken: "PAPER-INFY",
    exchange: "NSE",
    segment: "EQ",
    tradingSymbol: "INFY",
    name: "Infosys",
    isin: "INE009A01021",
    lotSize: 1,
    tickSize: "0.05",
  },
];

export const FIXED_NOW = new Date("2025-10-06T04:00:00.000Z");

export interface PaperSetup {
  readonly quotes: MemoryQuoteSource;
  readonly adapter: PaperAdapter;
  readonly creds: BrokerCredentials;
  readonly ctx: () => AccountCallContext;
}

/** A paper adapter with deterministic ids and clock, a quote for NIFTY_CE (99.95 / 100.05) and one account. */
export async function paperSetup(options: Partial<PaperAdapterOptions> = {}): Promise<PaperSetup> {
  const quotes = new MemoryQuoteSource();
  quotes.set(NIFTY_CE, { ltp: "100", bid: "99.95", ask: "100.05", ts: FIXED_NOW.getTime() });
  let seq = 0;
  const adapter = new PaperAdapter({
    quotes,
    instruments: INSTRUMENTS,
    now: () => FIXED_NOW,
    newId: (kind) => {
      seq += 1;
      return `${kind === "order" ? "O" : "T"}${String(seq)}`;
    },
    ...options,
  });
  const creds = await adapter.exchangeToken({ signal: new AbortController().signal });
  return { quotes, adapter, creds, ctx: () => ({ signal: new AbortController().signal, creds }) };
}

export function order(overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    instrumentKey: NIFTY_CE,
    side: "BUY",
    type: "MARKET",
    product: "INTRADAY",
    validity: "DAY",
    qty: 75,
    ...overrides,
  };
}
