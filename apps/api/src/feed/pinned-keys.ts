/**
 * The instruments the platform feed always streams (phase-1b "Feed source"): every MARKET_INDEX_KEYS index, then the
 * NIFTY 50 constituents (`NIFTY_50_KEYS`), so the navbar ticker, the footer and the market overview always have
 * quotes. Canonical keys, equal to the dev seed's and to what the instrument masters produce.
 */
import { isInstrumentKey, MARKET_INDEX_KEYS, NIFTY_50_KEYS } from "@finlytics/shared";
import type { InstrumentKey } from "@finlytics/shared";

export const INDEX_KEYS: readonly InstrumentKey[] = Object.freeze(
  Object.values(MARKET_INDEX_KEYS).filter((key) => isInstrumentKey(key)),
);

export const PINNED_KEYS: readonly InstrumentKey[] = Object.freeze([
  ...new Set<InstrumentKey>([...INDEX_KEYS, ...NIFTY_50_KEYS.filter((key) => isInstrumentKey(key))]),
]);
