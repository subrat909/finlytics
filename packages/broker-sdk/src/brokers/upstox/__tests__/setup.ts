/** Shared setup for the Upstox tests: the adapter wired to a FakeUpstox, with the fixture master as its resolver. */
import type { InstrumentKey } from "@finlytics/shared";

import type { AccountCallContext } from "../../../adapter";
import { Secret } from "../../../credentials";
import type { BrokerCredentials } from "../../../credentials";
import type { InstrumentRow, PlaceOrderInput } from "../../../models";
import { UpstoxAdapter } from "../adapter";
import type { UpstoxAdapterOptions } from "../adapter";
import { UpstoxInstrumentMap } from "../instruments";
import { toInstrumentRow } from "../mappers";
import { UpstoxInstrumentSchema } from "../types";

import { FakeUpstox, fixture, VALID_TOKEN } from "./fake-upstox";
import type { FakeUpstoxOptions } from "./fake-upstox";

/** 09:30 IST on Monday 6 October 2025. */
export const NOW = new Date("2025-10-06T04:00:00.000Z");

/** Upstox `NSE_FO|45450` in the fixtures: NIFTY 6 Mar 2025 22500 CE, lot 75, tick 0.05, freeze 1800. */
export const NIFTY_CE = "NSE_FO|NIFTY|2025-03-06|22500|CE" as InstrumentKey;
export const NIFTY_CE_TOKEN = "NSE_FO|45450";
export const NIFTY_INDEX = "NSE_INDEX|NIFTY 50" as InstrumentKey;
export const BANKNIFTY_PE = "NSE_FO|BANKNIFTY|2023-10-25|38000|PE" as InstrumentKey;
export const YESBANK = "NSE_EQ|YESBANK" as InstrumentKey;
export const CRUDE_FUT = "MCX_FO|CRUDEOIL|2025-11-19" as InstrumentKey;
export const UNKNOWN_KEY = "NSE_EQ|NOTLISTED" as InstrumentKey;

/** The fixture master, mapped. */
export function fixtureRows(): InstrumentRow[] {
  const rows: InstrumentRow[] = [];
  for (const raw of fixture("instruments.json") as unknown[]) {
    const parsed = UpstoxInstrumentSchema.safeParse(raw);
    const row = parsed.success ? toInstrumentRow(parsed.data) : undefined;
    if (row !== undefined && !rows.some((seen) => seen.instrumentKey === row.instrumentKey)) rows.push(row);
  }
  return rows;
}

export interface UpstoxSetup {
  readonly fake: FakeUpstox;
  readonly adapter: UpstoxAdapter;
  readonly creds: BrokerCredentials;
  readonly expiredCreds: BrokerCredentials;
  readonly ctx: (signal?: AbortSignal) => AccountCallContext;
}

export function upstoxSetup(
  options: Partial<UpstoxAdapterOptions> = {},
  fakeOptions: FakeUpstoxOptions = {},
): UpstoxSetup {
  const fake = new FakeUpstox(fakeOptions);
  let guid = 0;
  const adapter = new UpstoxAdapter({
    appCredentials: { apiKey: Secret.of("redacted-api-key"), apiSecret: Secret.of("redacted-api-secret") },
    instruments: new UpstoxInstrumentMap(fixtureRows()),
    fetch: fake.fetch,
    webSocket: fake.webSocket,
    now: () => NOW,
    newGuid: () => {
      guid += 1;
      return `guid-${String(guid)}`;
    },
    ...options,
  });
  const creds: BrokerCredentials = { accessToken: Secret.of(VALID_TOKEN), clientId: "******" };
  return {
    fake,
    adapter,
    creds,
    expiredCreds: { accessToken: Secret.of("expired-access-token") },
    ctx: (signal = new AbortController().signal) => ({ signal, creds }),
  };
}

export function niftyOrder(overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
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
