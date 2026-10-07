"use client";

import { useEffect, useRef, useState } from "react";

import { ErrorState } from "@finlytics/ui/components/error-state";

import type { ChartInterval } from "../schemas";

/** The vendored, licensed Advanced Charts library (CLAUDE.md "Charts"), served from `public/`. */
export const TV_LIBRARY_PATH = "/charting_library/";
const UDF_URL = "/v1/udf";
/** The UDF datafeed polls `/v1/udf/history` for the forming bar (our api, never a broker). */
const UDF_UPDATE_MS = 5_000;

const INTERVALS: Readonly<Record<ChartInterval, string>> = {
  M1: "1",
  M3: "3",
  M5: "5",
  M15: "15",
  M30: "30",
  H1: "60",
  H4: "240",
  D1: "1D",
  W1: "1W",
};

interface TradingViewWidget {
  remove(): void;
  changeTheme?(theme: "light" | "dark"): Promise<void> | void;
}

interface TradingViewGlobals {
  TradingView?: { widget: new (options: Record<string, unknown>) => TradingViewWidget };
  Datafeeds?: { UDFCompatibleDatafeed: new (url: string, updateFrequency?: number) => unknown };
}

const loaded = new Map<string, Promise<void>>();

/**
 * Adds a script once per page. Created by our own (nonced) bundle, so the CSP's `'strict-dynamic'` trusts it; no
 * inline code and no new source in the policy.
 */
function loadScript(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      loaded.delete(src);
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.append(script);
  });
  loaded.set(src, promise);
  return promise;
}

function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export interface TradingViewChartProps {
  instrumentKey: string;
  timeframe: ChartInterval;
  /** The UDF datafeed bundle that ships with the library (`datafeeds/udf/dist/bundle.js`). */
  datafeedPath: string;
  summary: string;
}

/**
 * TradingView Advanced Charts with the UDF datafeed pointed at our `/v1/udf` (plan 1.6). The widget follows the
 * app's theme and is removed (`widget.remove()`) on unmount or before a new instrument/timeframe is drawn.
 */
export default function TradingViewChart({ instrumentKey, timeframe, datafeedPath, summary }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let widget: TradingViewWidget | undefined;
    let cancelled = false;
    let observer: MutationObserver | undefined;

    Promise.all([loadScript(`${TV_LIBRARY_PATH}charting_library.js`), loadScript(datafeedPath)]).then(
      () => {
        const globals = window as unknown as TradingViewGlobals;
        if (cancelled || !globals.TradingView || !globals.Datafeeds) {
          if (!cancelled) setFailed(true);
          return;
        }
        widget = new globals.TradingView.widget({
          container,
          library_path: TV_LIBRARY_PATH,
          symbol: instrumentKey,
          interval: INTERVALS[timeframe],
          datafeed: new globals.Datafeeds.UDFCompatibleDatafeed(UDF_URL, UDF_UPDATE_MS),
          locale: "en",
          timezone: "Asia/Kolkata",
          theme: currentTheme(),
          autosize: true,
          disabled_features: ["use_localstorage_for_settings"],
        });
        observer = new MutationObserver(() => {
          void widget?.changeTheme?.(currentTheme());
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );

    return () => {
      cancelled = true;
      observer?.disconnect();
      widget?.remove();
    };
  }, [instrumentKey, timeframe, datafeedPath, attempt]);

  if (failed) {
    return (
      <ErrorState
        size="inline"
        title="The chart library didn't load"
        description="Check your connection and try again."
        onRetry={() => {
          setFailed(false);
          setAttempt((count) => count + 1);
        }}
      />
    );
  }

  return (
    <div className="relative h-full w-full" data-slot="tradingview-chart">
      <div ref={containerRef} role="img" aria-label={summary} className="absolute inset-0" />
    </div>
  );
}
