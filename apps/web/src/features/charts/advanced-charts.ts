import { existsSync } from "node:fs";
import path from "node:path";

/** Where the UDF datafeed bundle may sit next to the vendored library (it ships in the library's repository). */
const DATAFEED_CANDIDATES = ["charting_library/datafeeds/udf/dist/bundle.js", "datafeeds/udf/dist/bundle.js"] as const;

/**
 * The public URL of the UDF datafeed when the licensed TradingView Advanced Charts library is vendored in `public/`
 * (`/charting_library/charting_library.js`), else undefined and the chart uses Lightweight Charts. Checked on the
 * server per request (cheap `stat`s), so dropping the library in needs no rebuild of this code.
 */
export function advancedChartsDatafeed(publicDir = path.join(process.cwd(), "public")): string | undefined {
  if (!existsSync(path.join(publicDir, "charting_library", "charting_library.js"))) return undefined;
  const found = DATAFEED_CANDIDATES.find((candidate) => existsSync(path.join(publicDir, candidate)));
  return found === undefined ? undefined : `/${found}`;
}
