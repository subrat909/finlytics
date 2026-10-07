"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useMarketStore } from "@/features/realtime/store";

import type { LiveQuote } from "../lib/pnl";

/**
 * Live prices for many instruments at once (portfolio totals): one store selector returning `[ltp, chg]` pairs,
 * compared shallowly, so the caller re-renders only when one of these prices moves (≤ 10 times a second, the tick
 * batch rate). Subscribing is the caller's job (`useSubscribe`). The previous close is `ltp − chg`.
 */
export function useLiveQuotes(keys: readonly string[]): ReadonlyMap<string, LiveQuote> {
  const flat = useMarketStore(
    useShallow((state) =>
      keys.flatMap((key) => {
        const tick = state.ticks.get(key);
        return [tick?.ltp, tick?.chg];
      }),
    ),
  );
  return useMemo(() => {
    const quotes = new Map<string, LiveQuote>();
    keys.forEach((key, index) => {
      const ltp = flat[index * 2];
      const chg = flat[index * 2 + 1];
      if (ltp === undefined) return;
      quotes.set(key, { ltp, prevClose: chg === undefined ? null : ltp - chg });
    });
    return quotes;
  }, [keys, flat]);
}
