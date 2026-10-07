/**
 * How instruments read in the UI: symbols with their F&O contract, expiries, one-line descriptions and the names
 * screen readers hear. Deterministic (no `Intl`), so the server render and the browser agree.
 */
import type { Instrument } from "@finlytics/shared";

type Described = Pick<
  Instrument,
  "exchange" | "segment" | "symbol" | "name" | "expiry" | "strike" | "optionType" | "lotSize"
>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function expiryParts(expiry: string): { day: string; month: string; year: string } {
  const [year = "", month = "", day = ""] = expiry.split("-");
  return { day: String(Number(day)), month: MONTHS[Number(month) - 1] ?? month, year };
}

/** `2025-10-30` → `30 Oct 25`. */
export function shortExpiry(expiry: string): string {
  const { day, month, year } = expiryParts(expiry);
  return `${day} ${month} ${year.slice(2)}`;
}

/** `2025-10-30` → `30 Oct 2025`. */
export function longExpiry(expiry: string): string {
  const { day, month, year } = expiryParts(expiry);
  return `${day} ${month} ${year}`;
}

/** `24000.00` → `24000`, `82.50` → `82.5`: strikes as traders write them. */
export function formatStrike(strike: string): string {
  return strike.includes(".") ? strike.replace(/\.?0+$/, "") : strike;
}

export function isDerivative(instrument: Pick<Instrument, "segment">): boolean {
  return instrument.segment === "FUT" || instrument.segment === "OPT";
}

/** The F&O contract after the symbol: `24000 CE`, `FUT`; empty for equities and indices. */
export function contractOf(instrument: Described): string {
  if (instrument.segment === "FUT") return "FUT";
  if (instrument.segment !== "OPT") return "";
  return [instrument.strike === null ? undefined : formatStrike(instrument.strike), instrument.optionType ?? undefined]
    .filter((part) => part !== undefined)
    .join(" ");
}

/** A row's first line: `NIFTY 24000 CE`, `NIFTY FUT`, `RELIANCE`. */
export function displaySymbol(instrument: Described): string {
  const contract = contractOf(instrument);
  return contract === "" ? instrument.symbol : `${instrument.symbol} ${contract}`;
}

/** A row's second line: the expiry for F&O (`30 Oct 25`), the company or index name otherwise. */
export function secondaryLabel(instrument: Described): string {
  if (isDerivative(instrument) && instrument.expiry !== null) return shortExpiry(instrument.expiry);
  return instrument.name;
}

/** A search result's detail line: `Expiry 30 Oct 2025 · Lot 75`, or the name. */
export function searchDetail(instrument: Described): string {
  if (!isDerivative(instrument)) return instrument.name;
  const parts = [instrument.expiry === null ? undefined : `Expiry ${longExpiry(instrument.expiry)}`];
  parts.push(`Lot ${String(instrument.lotSize)}`);
  return parts.filter((part) => part !== undefined).join(" · ");
}

/** A one-line description: `NSE · Reliance Industries`, `NFO · 30 Oct 25 24000 CE`, `NFO · 30 Oct 25 FUT`. */
export function describeInstrument(instrument: Described): string {
  if (isDerivative(instrument)) {
    const detail = [instrument.expiry === null ? undefined : shortExpiry(instrument.expiry), contractOf(instrument)]
      .filter((part) => part !== undefined && part !== "")
      .join(" ");
    return `${instrument.exchange} · ${detail}`;
  }
  return `${instrument.exchange} · ${instrument.name}`;
}

const OPTION_WORDS = { CE: "call", PE: "put" } as const;

/**
 * What screen readers hear and titles show. It starts with the row's visible first line (WCAG 2.5.3, label in name),
 * then spells the contract out: `NIFTY 24000 CE, call, expiry 30 Oct 2025, NFO`; `NIFTY FUT, futures, …`;
 * `RELIANCE, NSE`.
 */
export function accessibleName(instrument: Described): string {
  if (!isDerivative(instrument)) return `${instrument.symbol}, ${instrument.exchange}`;
  const words =
    instrument.segment === "OPT"
      ? instrument.optionType === null
        ? "option"
        : OPTION_WORDS[instrument.optionType]
      : "futures";
  const expiry = instrument.expiry === null ? "" : `, expiry ${longExpiry(instrument.expiry)}`;
  return `${displaySymbol(instrument)}, ${words}${expiry}, ${instrument.exchange}`;
}
