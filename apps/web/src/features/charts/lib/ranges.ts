/**
 * The bottom bar's ranges (pure): where each range starts, counted back from the latest bar, in chart time.
 */
import type { ChartRange } from "../schemas";

import { DAY_S, dayStart, weekdaysBack, yearStart } from "./time";

/** The first chart time a range shows (`-Infinity` for all history). */
export function rangeStart(range: ChartRange, lastTime: number): number {
  switch (range) {
    case "1D":
      return dayStart(lastTime);
    case "5D":
      return weekdaysBack(lastTime, 4);
    case "1M":
      return dayStart(lastTime) - 30 * DAY_S;
    case "3M":
      return dayStart(lastTime) - 91 * DAY_S;
    case "6M":
      return dayStart(lastTime) - 182 * DAY_S;
    case "YTD":
      return yearStart(lastTime);
    case "1Y":
      return dayStart(lastTime) - 365 * DAY_S;
    case "ALL":
      return Number.NEGATIVE_INFINITY;
  }
}
