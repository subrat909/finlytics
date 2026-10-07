"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Tooltip } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";

import { ErrorState } from "@finlytics/ui/components/error-state";
import { Skeleton } from "@finlytics/ui/components/skeleton";

import { useMarketOverview } from "@/features/market/hooks/use-market-overview";
import { useQuoteSeed } from "@/features/realtime/hooks/use-quote-seed";
import { useSubscribe } from "@/features/realtime/hooks/use-realtime";
import { isApiError } from "@/lib/api/client";

import { useCandleHistory, useInstrument } from "../hooks/use-chart-data";
import { exchangeOfKey, resample, sessionOf } from "../lib/bars";
import type { Bar } from "../lib/bars";
import type { ChartController } from "../lib/chart/controller";
import { isDrawingKind } from "../lib/drawings/types";
import type { DrawingTool } from "../lib/drawings/types";
import { formatNumber, precisionOf } from "../lib/format";
import { rangeStart } from "../lib/ranges";
import { composeScreenshot, downloadCanvas, screenshotFileName } from "../lib/screenshot";
import { loadDrawings, loadLayout, saveDrawings, saveLayout } from "../lib/storage";
import { readChartColors } from "../lib/theme-colors";
import { INTERVALS, RANGES } from "../schemas";
import type { ChartInterval, ChartRange } from "../schemas";
import {
  WorkspaceStoreContext,
  createWorkspaceStore,
  layoutOf,
  useWorkspace,
  useWorkspaceStore,
} from "../store/workspace-store";

import { BottomBar } from "./bottom-bar";
import ChartCanvas from "./chart-canvas";
import { ChartControllerContext, ChartInfoContext } from "./chart-context";
import type { ChartInfo } from "./chart-context";
import { ChartLegend } from "./chart-legend";
import { DrawingSettingsDialog } from "./drawing-settings-dialog";
import { DrawingStyleBar } from "./drawing-style-bar";
import { DrawingToolbar } from "./drawing-toolbar";
import { IndicatorSettingsDialog } from "./indicator-settings-dialog";
import { IndicatorsDialog } from "./indicators-dialog";
import { RightPanel } from "./right-panel";
import { ChartSettingsDialog, TextNoteDialog } from "./settings-dialogs";
import { SymbolSearchDialog } from "./symbol-search";
import { TopToolbar } from "./top-toolbar";
import { PortalContainerContext } from "./ui";

/** `/charts?key=…&tf=…` (the interval in the URL keeps a chart shareable). */
export function chartsHref(key: string, interval: ChartInterval): Route {
  return `/charts?key=${encodeURIComponent(key)}&tf=${interval}` as Route;
}

/** Fewer bars than this and older history loads at once (a long weekend can empty the first window)… */
const MIN_BARS = 120;
/** …up to this many windows; further back is the user's scroll. */
const MAX_AUTO_PAGES = 6;

/** Typing targets: shortcuts never fire while the user writes. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const SHORTCUT_TOOLS: Readonly<Record<string, DrawingTool>> = {
  KeyT: "trend",
  KeyH: "hline",
  KeyV: "vline",
  KeyF: "fib",
  KeyC: "crossline",
  KeyR: "rect",
};

export interface ChartWorkspaceProps {
  instrumentKey: string;
  /** From `?tf=`; without it the saved layout's interval. */
  interval?: ChartInterval | undefined;
  /** The signed-in user: the layout is saved per user. */
  userId?: string | undefined;
}

/**
 * The chart workspace (TradingView-style): top toolbar, drawing toolbar, the chart with its legend, the bottom bar and
 * the side panel. Loaded with `next/dynamic` (`ssr: false`), so the saved layout and drawings are read from
 * localStorage before the first render; mounted per instrument (the page keys it), so state never leaks across symbols.
 */
export default function ChartWorkspace({ instrumentKey, interval, userId }: ChartWorkspaceProps) {
  const [store] = useState(() => {
    const layout = loadLayout(userId);
    return createWorkspaceStore(interval === undefined ? layout : { ...layout, interval }, loadDrawings(instrumentKey));
  });
  return (
    <WorkspaceStoreContext.Provider value={store}>
      <Tooltip.Provider delayDuration={300} skipDelayDuration={150}>
        <Workspace instrumentKey={instrumentKey} userId={userId} />
      </Tooltip.Provider>
    </WorkspaceStoreContext.Provider>
  );
}

function Workspace({ instrumentKey, userId }: { instrumentKey: string; userId: string | undefined }) {
  const store = useWorkspaceStore();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [controller, setController] = useState<ChartController | null>(null);
  const controllerRef = useRef<ChartController | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [message, setMessage] = useState("");
  const interval = useWorkspace((state) => state.interval);
  const panelOpen = useWorkspace((state) => state.panelOpen);
  const dialog = useWorkspace((state) => state.dialog);
  const symbolQuery = useWorkspace((state) => state.symbolQuery);
  const openDialog = useWorkspace((state) => state.openDialog);

  const subscribed = useMemo(() => [instrumentKey], [instrumentKey]);
  useSubscribe(subscribed);
  useQuoteSeed(subscribed);
  const overview = useMarketOverview();
  const simulated = overview.data?.feed.live === false;

  const instrument = useInstrument(instrumentKey);
  const { query, bars: sourceBars } = useCandleHistory(instrumentKey, interval);
  const exchange = instrument.data?.exchange ?? exchangeOfKey(instrumentKey);
  const session = useMemo(() => sessionOf(exchange), [exchange]);
  const bars = useMemo(() => resample(sourceBars, interval, session), [sourceBars, interval, session]);
  const tickSize = instrument.data?.tickSize;
  const precision = precisionOf(tickSize);
  const minMove = tickSize !== undefined && Number(tickSize) > 0 ? Number(tickSize) : 10 ** -precision;
  const symbol =
    instrument.data?.tradingSymbol ?? instrument.data?.symbol ?? instrumentKey.split("|")[1] ?? instrumentKey;
  const info = useMemo<ChartInfo>(
    () => ({ instrumentKey, symbol, name: instrument.data?.name ?? "", exchange, precision, session }),
    [instrumentKey, symbol, instrument.data?.name, exchange, precision, session],
  );

  const latest = useRef({ query, bars, interval });
  useLayoutEffect(() => {
    latest.current = { query, bars, interval };
  });

  // Persistence: the layout per user, the drawings per instrument.
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        const layout = layoutOf(state);
        const before = layoutOf(previous);
        if (
          Object.keys(layout).some((key) => layout[key as keyof typeof layout] !== before[key as keyof typeof before])
        ) {
          saveLayout(userId, layout);
        }
        if (state.history.present !== previous.history.present) saveDrawings(instrumentKey, state.history.present);
      }),
    [store, userId, instrumentKey],
  );

  // The URL keeps the interval (shareable, survives reload) without a server round trip.
  useEffect(() => {
    window.history.replaceState(null, "", chartsHref(instrumentKey, interval));
  }, [instrumentKey, interval]);

  const onReady = useCallback((next: ChartController | null) => {
    controllerRef.current = next;
    setController(next);
  }, []);

  const fetchOlder = useCallback(() => {
    const current = latest.current.query;
    if (!current.hasPreviousPage) return;
    if (current.isFetchingPreviousPage) return;
    void current.fetchPreviousPage().finally(() => {
      controllerRef.current?.resetPaging();
    });
  }, []);

  // Too few bars to fill the chart: load older history right away.
  const { isSuccess, isFetching, hasPreviousPage, fetchPreviousPage } = query;
  const pageCount = query.data?.pages.length ?? 0;
  useEffect(() => {
    if (isSuccess && !isFetching && hasPreviousPage && bars.length < MIN_BARS && pageCount < MAX_AUTO_PAGES) {
      void fetchPreviousPage();
    }
  }, [isSuccess, isFetching, hasPreviousPage, bars.length, pageCount, fetchPreviousPage]);

  // A range zooms once its interval's bars reach back far enough (loading older pages as needed).
  const pendingRange = useRef<ChartRange | null>(null);
  const applyPendingRange = useCallback(() => {
    const range = pendingRange.current;
    const target = controllerRef.current;
    const { query: current, bars: loaded, interval: shown } = latest.current;
    if (range === null || target === null || shown !== RANGES[range].interval || current.isPending) return;
    const last: Bar | undefined = loaded.at(-1);
    const first: Bar | undefined = loaded[0];
    if (last === undefined || first === undefined) {
      if (!current.isFetching) pendingRange.current = null;
      return;
    }
    const start = rangeStart(range, last.time);
    if (first.time > start && current.hasPreviousPage) {
      if (!current.isFetching) void current.fetchPreviousPage();
      return;
    }
    target.setVisibleRange(start, last.time + INTERVALS[shown].seconds);
    pendingRange.current = null;
  }, []);
  useEffect(() => {
    applyPendingRange();
  }, [bars, isFetching, hasPreviousPage, controller, applyPendingRange]);

  const onRange = (range: ChartRange) => {
    pendingRange.current = range;
    store.getState().setInterval(RANGES[range].interval);
    applyPendingRange();
    setMessage(`Showing ${RANGES[range].long.toLowerCase()}.`);
  };

  // Full screen: the workspace element itself (dialogs portal into it, so they stay visible).
  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);
  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void rootRef.current?.requestFullscreen().catch(() => undefined);
    } catch {
      setMessage("Full screen isn't available in this browser.");
    }
  };

  const takeScreenshot = () => {
    const target = controllerRef.current;
    const element = rootRef.current;
    if (target === null || element === null) return;
    const meta = {
      symbol,
      exchange,
      interval: INTERVALS[interval].short,
      intraday: INTERVALS[interval].intraday,
      bar: target.getLegend().bar,
      precision,
      colors: readChartColors(element),
      fontFamily: getComputedStyle(element).fontFamily,
    };
    const canvas = composeScreenshot(target.screenshot(), meta);
    void downloadCanvas(canvas, screenshotFileName(meta, Math.floor(Date.now() / 1_000))).then(() => {
      setMessage("Screenshot saved.");
    });
  };

  // Keyboard: Alt+T/H/V/F tools, Esc cancels, Delete removes, Ctrl/⌘+Z/Y undo and redo, typing opens symbol search.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return;
      const element = rootRef.current;
      const active = document.activeElement;
      const inside = element !== null && (active === null || active === document.body || element.contains(active));
      const state = store.getState();
      if (!inside || state.dialog !== null || state.textRequest !== null || state.editingIndicator !== null) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.altKey && !mod) {
        const tool = SHORTCUT_TOOLS[event.code];
        if (tool !== undefined) {
          event.preventDefault();
          state.setTool(tool);
        }
        return;
      }
      if (mod && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          state.undo();
        } else if (key === "y" || (key === "z" && event.shiftKey)) {
          event.preventDefault();
          state.redo();
        }
        return;
      }
      if (event.key === "Escape") {
        if (controllerRef.current?.cancelDrawing()) return;
        if (state.selectedId !== null) state.selectDrawing(null);
        else if (isDrawingKind(state.tool)) state.setTool("crosshair");
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (state.deleteSelected()) event.preventDefault();
        return;
      }
      if (!event.shiftKey && /^[a-z0-9]$/i.test(event.key)) {
        event.preventDefault();
        state.openDialog("symbol", event.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store]);

  const last = bars.at(-1);
  const label = INTERVALS[interval].long;
  const summary =
    last === undefined
      ? `${symbol} chart, ${label} bars, no history yet; live ticks draw the first bar`
      : `${symbol} chart, ${label} bars, ${String(bars.length)} bars, last close ${formatNumber(last.close, precision)}`;

  let chartBody: React.ReactNode;
  if (query.isError && sourceBars.length === 0) {
    chartBody = (
      <ErrorState
        size="inline"
        className="h-full"
        title="The candles didn't load"
        description="The Finlytics service didn't answer. Try again in a moment."
        reference={isApiError(query.error) ? query.error.requestId : undefined}
        onRetry={async () => {
          await query.refetch({ throwOnError: true });
        }}
      />
    );
  } else {
    chartBody = (
      <>
        <ChartCanvas
          instrumentKey={instrumentKey}
          sourceBars={sourceBars}
          bars={bars}
          interval={interval}
          session={session}
          precision={precision}
          minMove={minMove}
          summary={summary}
          onReady={onReady}
          onNeedOlder={fetchOlder}
        />
        <ChartLegend simulated={simulated} />
        {query.isPending ? (
          <div
            role="status"
            aria-label="Loading candles"
            className="absolute inset-x-6 top-16 bottom-8 z-10 flex items-end gap-1.5"
          >
            {Array.from({ length: 28 }, (_, index) => (
              <Skeleton
                key={index}
                className={index % 3 === 0 ? "h-2/5 flex-1" : index % 3 === 1 ? "h-3/5 flex-1" : "h-1/2 flex-1"}
              />
            ))}
          </div>
        ) : null}
        {query.isSuccess && bars.length === 0 && !query.isFetching ? (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 z-10 px-6 text-center text-sm text-fg-muted">
            No price history for this interval yet. Live ticks draw the first candle.
          </p>
        ) : null}
        {query.isFetchingPreviousPage ? (
          <p
            role="status"
            className="absolute bottom-2 left-2 z-10 rounded-sm bg-surface-2 px-2 py-0.5 text-xs text-fg-muted"
          >
            Loading older history…
          </p>
        ) : null}
      </>
    );
  }

  return (
    <PortalContainerContext.Provider value={root}>
      <ChartInfoContext.Provider value={info}>
        <ChartControllerContext.Provider value={controller}>
          <div
            ref={(node) => {
              rootRef.current = node;
              setRoot(node);
            }}
            data-slot="chart-workspace"
            className="@container/workspace flex min-w-0 flex-1 flex-col gap-1 bg-bg p-1"
          >
            <TopToolbar
              simulated={simulated}
              fullscreen={fullscreen}
              onToggleFullscreen={toggleFullscreen}
              onScreenshot={takeScreenshot}
            />
            <div className="flex min-h-0 flex-1 gap-1">
              <DrawingToolbar className="hidden @xl/workspace:flex" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <section
                  aria-label={`${symbol} chart`}
                  data-slot="chart-area"
                  className="relative min-h-60 flex-1 overflow-hidden rounded-sm border border-border bg-surface-1"
                >
                  {chartBody}
                  <DrawingStyleBar />
                </section>
                <BottomBar onRange={onRange} />
              </div>
              {panelOpen ? <RightPanel simulated={simulated} hrefFor={(key) => chartsHref(key, interval)} /> : null}
            </div>
            <SymbolSearchDialog
              open={dialog === "symbol"}
              onOpenChange={(open) => {
                openDialog(open ? "symbol" : null);
              }}
              initialQuery={symbolQuery}
              currentKey={instrumentKey}
              onSelect={(option) => {
                if (option.key !== instrumentKey) router.push(chartsHref(option.key, interval));
              }}
            />
            <IndicatorsDialog />
            <IndicatorSettingsDialog />
            <ChartSettingsDialog />
            <TextNoteDialog />
            <DrawingSettingsDialog />
            <p aria-live="polite" className="sr-only" data-slot="chart-announcer">
              {message}
            </p>
          </div>
        </ChartControllerContext.Provider>
      </ChartInfoContext.Provider>
    </PortalContainerContext.Provider>
  );
}
