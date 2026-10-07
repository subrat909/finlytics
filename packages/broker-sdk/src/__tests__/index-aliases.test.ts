import { MARKET_INDEX_KEYS } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import { aliasForm, MARKET_INDEX_ALIASES, marketIndexAlias, marketIndexByDhanSecurityId } from "../index-aliases";

describe("market index aliases", () => {
  it("covers exactly MARKET_INDEX_KEYS, in order, with the dev seed's symbols and names", () => {
    expect(MARKET_INDEX_ALIASES.map((alias) => alias.key)).toEqual(Object.values(MARKET_INDEX_KEYS));
    expect(MARKET_INDEX_ALIASES.map((alias) => alias.id)).toEqual(Object.keys(MARKET_INDEX_KEYS));
    expect(MARKET_INDEX_ALIASES.map((alias) => [alias.symbol, alias.name])).toEqual([
      ["NIFTY 50", "Nifty 50"],
      ["NIFTY BANK", "Nifty Bank"],
      ["NIFTY FIN SERVICE", "Nifty Financial Services"],
      ["NIFTY MID SELECT", "Nifty Midcap Select"],
      ["NIFTY NEXT 50", "Nifty Next 50"],
      ["NIFTY IT", "Nifty IT"],
      ["INDIA VIX", "India VIX"],
      ["SENSEX", "BSE Sensex"],
      ["BANKEX", "BSE Bankex"],
    ]);
    expect(Object.isFrozen(MARKET_INDEX_ALIASES)).toBe(true);
  });

  it("matches broker spellings exactly, after case and spacing, on the right exchange only", () => {
    expect(marketIndexAlias("NSE_INDEX", "Nifty 50")?.id).toBe("NIFTY");
    expect(marketIndexAlias("NSE_INDEX", undefined, null, " nifty   fin service ")?.id).toBe("FINNIFTY");
    expect(marketIndexAlias("NSE_INDEX", "Nifty Auto", "MIDCPNIFTY")?.id).toBe("MIDCPNIFTY");
    expect(marketIndexAlias("BSE_INDEX", "S&P BSE SENSEX")?.id).toBe("SENSEX");
    expect(marketIndexAlias("BSE_INDEX", "SENSEX50")).toBeUndefined();
    expect(marketIndexAlias("NSE_INDEX", "SENSEX")).toBeUndefined();
    expect(marketIndexAlias("NSE_INDEX")).toBeUndefined();
    expect(aliasForm("  India\tVIX ")).toBe("INDIA VIX");
  });

  it("knows Dhan's fixed IDX_I security ids", () => {
    expect(["13", "25", "27", "442", "21", "51", "69"].map((id) => marketIndexByDhanSecurityId(id)?.key)).toEqual([
      "NSE_INDEX|NIFTY 50",
      "NSE_INDEX|NIFTY BANK",
      "NSE_INDEX|NIFTY FIN SERVICE",
      "NSE_INDEX|NIFTY MID SELECT",
      "NSE_INDEX|INDIA VIX",
      "BSE_INDEX|SENSEX",
      "BSE_INDEX|BANKEX",
    ]);
    expect(marketIndexByDhanSecurityId(" 13 ")?.id).toBe("NIFTY");
    expect(marketIndexByDhanSecurityId("1333")).toBeUndefined();
  });
});
