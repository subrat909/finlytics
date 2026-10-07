/**
 * The market indices every instrument master must name exactly as `MARKET_INDEX_KEYS` (@finlytics/shared) does, plan
 * phase-1b "Adapters". Brokers spell them their own way (Upstox `NSE_INDEX|Nifty 50`, trading symbol `NIFTY`; Dhan
 * `IDX_I` security 13, symbol `NIFTY`, display name `Nifty 50`), so both masters map them through this one table.
 * Symbols and names equal the dev seed's (`packages/database/prisma/seed/instruments.ts`): a master import that
 * overwrites `Instrument.tradingSymbol`/`name` writes the same values whichever broker ran last.
 *
 * Only exact spellings match (after trimming, upper-casing and collapsing spaces): `SENSEX50` stays its own index.
 */
import { MARKET_INDEX_KEYS, parseInstrumentKey } from "@finlytics/shared";
import type { InstrumentKey, MarketIndexId } from "@finlytics/shared";

/** One pinned market index and the spellings that mean it. */
export interface MarketIndexAlias {
  readonly id: MarketIndexId;
  /** The canonical key (`NSE_INDEX|NIFTY 50`). */
  readonly key: InstrumentKey;
  readonly token: "NSE_INDEX" | "BSE_INDEX";
  /** The key's symbol (`NIFTY 50`); also the row's trading symbol, as in the seed. */
  readonly symbol: string;
  /** The display name, as in the seed (`Nifty 50`). */
  readonly name: string;
  /** Other spellings brokers use, upper case with single spaces. */
  readonly aliases: readonly string[];
  /** Dhan's `IDX_I` security id, where it is fixed and known. */
  readonly dhanSecurityId?: string | undefined;
}

interface AliasSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly dhanSecurityId?: string;
}

const SPECS = {
  NIFTY: { name: "Nifty 50", aliases: ["NIFTY", "NIFTY50", "CNX NIFTY"], dhanSecurityId: "13" },
  BANKNIFTY: {
    name: "Nifty Bank",
    aliases: ["BANKNIFTY", "BANK NIFTY", "NIFTYBANK", "CNX BANK"],
    dhanSecurityId: "25",
  },
  FINNIFTY: {
    name: "Nifty Financial Services",
    aliases: ["FINNIFTY", "NIFTY FINANCIAL SERVICES", "NIFTY FIN SERVICES", "NIFTYFINSERVICE", "NIFTY FINSERVICE"],
    dhanSecurityId: "27",
  },
  MIDCPNIFTY: {
    name: "Nifty Midcap Select",
    aliases: ["MIDCPNIFTY", "NIFTY MIDCAP SELECT", "NIFTY MIDSELECT", "NIFTYMIDSELECT"],
    dhanSecurityId: "442",
  },
  NIFTYNXT50: { name: "Nifty Next 50", aliases: ["NIFTYNXT50", "NIFTY NXT 50", "NIFTY NEXT50", "NIFTY JUNIOR"] },
  NIFTYIT: { name: "Nifty IT", aliases: ["NIFTYIT", "CNX IT", "CNXIT"] },
  INDIAVIX: { name: "India VIX", aliases: ["INDIAVIX", "NIFTY VIX"], dhanSecurityId: "21" },
  SENSEX: { name: "BSE Sensex", aliases: ["BSE SENSEX", "S&P BSE SENSEX"], dhanSecurityId: "51" },
  BANKEX: { name: "BSE Bankex", aliases: ["BSE BANKEX", "S&P BSE BANKEX"], dhanSecurityId: "69" },
} as const satisfies Record<MarketIndexId, AliasSpec>;

/** Upper case, single spaces, trimmed: how spellings are compared. */
export function aliasForm(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function build(): readonly MarketIndexAlias[] {
  return (Object.keys(SPECS) as MarketIndexId[]).map((id) => {
    const spec: AliasSpec = SPECS[id];
    const parsed = parseInstrumentKey(MARKET_INDEX_KEYS[id]);
    /* v8 ignore next 3 -- MARKET_INDEX_KEYS holds canonical index keys */
    if (!parsed.ok || parsed.value.segment !== "INDEX" || !parsed.value.token.endsWith("_INDEX")) {
      throw new TypeError(`MARKET_INDEX_KEYS.${id} is not an index key`);
    }
    return Object.freeze({
      id,
      key: parsed.value.key,
      token: parsed.value.token as "NSE_INDEX" | "BSE_INDEX",
      symbol: parsed.value.symbol,
      name: spec.name,
      aliases: Object.freeze([...spec.aliases]),
      ...(spec.dhanSecurityId === undefined ? {} : { dhanSecurityId: spec.dhanSecurityId }),
    });
  });
}

/** Every pinned market index, in `MARKET_INDEX_KEYS` order. */
export const MARKET_INDEX_ALIASES: readonly MarketIndexAlias[] = Object.freeze(build());

const BY_SPELLING = new Map<string, MarketIndexAlias>(
  MARKET_INDEX_ALIASES.flatMap((alias) =>
    [alias.symbol, ...alias.aliases].map((spelling) => [`${alias.token}|${aliasForm(spelling)}`, alias] as const),
  ),
);

const BY_DHAN_ID = new Map<string, MarketIndexAlias>(
  MARKET_INDEX_ALIASES.flatMap((alias) =>
    alias.dhanSecurityId === undefined ? [] : [[alias.dhanSecurityId, alias] as const],
  ),
);

/** The pinned index one of `spellings` names on `token` (the first that matches), else undefined. */
export function marketIndexAlias(
  token: string,
  ...spellings: readonly (string | null | undefined)[]
): MarketIndexAlias | undefined {
  for (const spelling of spellings) {
    const alias = BY_SPELLING.get(`${token}|${aliasForm(spelling)}`);
    if (alias !== undefined) return alias;
  }
  return undefined;
}

/** The pinned index with this Dhan `IDX_I` security id, else undefined. */
export function marketIndexByDhanSecurityId(securityId: string): MarketIndexAlias | undefined {
  return BY_DHAN_ID.get(securityId.trim());
}
