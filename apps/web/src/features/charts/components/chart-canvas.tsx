"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { useTick } from "@/features/realtime/hooks/use-realtime";
import type { Tick } from "@/features/realtime/schemas";

import type { Bar, LiveTick, Session } from "../lib/bars";
import { ChartController } from "../lib/chart/controller";
import { readChartColors } from "../lib/theme-colors";
import { toChartTime } from "../lib/time";
import type { ChartInterval } from "../schemas";
import { useWorkspaceStore } from "../store/workspace-store";
import type { WorkspaceState } from "../store/workspace-store";

type DayFields = Partial<Record<"open" | "high" | "low", number | null>>;

function dayValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** A realtime tick as the chart reads it (the day's open/high/low once the feed sends them). */
export function toLiveTick(tick: Tick, volumeDelta: number): LiveTick {
  const day = tick as Tick & DayFields;
  return {
    price: tick.ltp,
    time: toChartTime(tick.ts),
    volumeDelta,
    dayVolume: tick.vol !== null && tick.vol > 0 ? tick.vol : null,
    dayOpen: dayValue(day.open),
    dayHigh: dayValue(day.high),
    dayLow: dayValue(day.low),
  };
}

export interface ChartCanvasProps {
  instrumentKey: string;
  /** Bars of the api timeframe behind the interval. */
  sourceBars: readonly Bar[];
  /** Bars of the interval (resampled where needed). */
  bars: readonly Bar[];
  interval: ChartInterval;
  session: Session;
  precision: number;
  minMove: number;
  /** Read by screen readers instead of the canvas (docs/05: chart alt summary). */
  summary: string;
  onReady: (controller: ChartController | null) => void;
  onNeedOlder: () => void;
}

function drawingState(state: WorkspaceState) {
  return {
    drawings: state.history.present,
    selectedId: state.selectedId,
    hidden: state.drawingsHidden,
    locked: state.locked,
  };
}

/**
 * The Lightweight Charts canvas (Apache-2.0; TradingView is credited in the bottom bar). Owns one ChartController per
 * mount: workspace state goes to it through a store subscription and live ticks through a null-rendering feeder, so
 * neither re-renders this component. The theme is re-read from the tokens when `data-theme` changes.
 */
export default function ChartCanvas(props: ChartCanvasProps) {
  const { instrumentKey, sourceBars, bars, interval, session, precision, minMove, summary } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ChartController | null>(null);
  const latest = useRef(props);
  const latestTick = useRef<Tick | undefined>(undefined);
  const lastVolume = useRef<number | null>(null);
  const dataState = useRef<{ interval: ChartInterval | null; count: number }>({ interval: null, count: 0 });
  const store = useWorkspaceStore();

  useLayoutEffect(() => {
    latest.current = props;
  });

  // The chart: created once per mount, removed (with every listener, observer and frame) on unmount.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const initial = latest.current;
    const state = store.getState();
    const controller = new ChartController(
      element,
      {
        colors: readChartColors(element),
        fontFamily: getComputedStyle(element).fontFamily,
        settings: state.settings,
        chartType: state.chartType,
        scaleMode: state.scaleMode,
        autoScale: state.autoScale,
        precision: initial.precision,
        minMove: initial.minMove,
        interval: initial.interval,
        session: initial.session,
        symbol: initial.instrumentKey.split("|")[1] ?? initial.instrumentKey,
      },
      {
        onNeedOlder: () => {
          latest.current.onNeedOlder();
        },
        onDrawingCommit: (drawings, selectedId) => {
          store.getState().commitDrawings(drawings, selectedId);
        },
        onDrawingSelect: (id) => {
          store.getState().selectDrawing(id);
        },
        onDrawingPlaced: () => {
          store.getState().setTool("crosshair");
        },
        onTextRequest: (request) => {
          store.getState().requestText(request);
        },
        onAutoScaleChange: (autoScale) => {
          store.getState().setScale({ autoScale });
        },
      },
    );
    controllerRef.current = controller;
    dataState.current = { interval: null, count: 0 };
    controller.setIndicators(state.indicators);
    controller.setDrawings(drawingState(state));
    controller.setTool(state.tool);
    controller.setMagnet(state.magnet);

    const unsubscribe = store.subscribe((next, previous) => {
      if (next.chartType !== previous.chartType) controller.setChartType(next.chartType);
      if (next.indicators !== previous.indicators) controller.setIndicators(next.indicators);
      if (next.scaleMode !== previous.scaleMode || next.autoScale !== previous.autoScale) {
        controller.setScale(next.scaleMode, next.autoScale);
      }
      if (next.settings !== previous.settings) controller.setSettings(next.settings);
      if (next.tool !== previous.tool) controller.setTool(next.tool);
      if (next.magnet !== previous.magnet) controller.setMagnet(next.magnet);
      if (
        next.history.present !== previous.history.present ||
        next.selectedId !== previous.selectedId ||
        next.drawingsHidden !== previous.drawingsHidden ||
        next.locked !== previous.locked
      ) {
        controller.setDrawings(drawingState(next));
      }
    });
    const themeObserver = new MutationObserver(() => {
      controller.setColors(readChartColors(element), getComputedStyle(element).fontFamily);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    latest.current.onReady(controller);

    return () => {
      unsubscribe();
      themeObserver.disconnect();
      latest.current.onReady(null);
      controllerRef.current = null;
      controller.destroy();
    };
  }, [store]);

  // History: a new interval (or the first bars) starts at the latest bar; older pages keep the view.
  useEffect(() => {
    const controller = controllerRef.current;
    if (controller === null) return;
    const previous = dataState.current;
    const mode = previous.interval !== interval || previous.count === 0 ? "reset" : "keep";
    controller.setData(sourceBars, bars, interval, session, mode);
    dataState.current = { interval, count: bars.length };
    // The latest tick again (idempotent): today's bar shows even when no tick arrives after the history.
    const tick = latestTick.current;
    if (tick !== undefined) controller.applyTick(toLiveTick(tick, 0));
  }, [sourceBars, bars, interval, session]);

  useEffect(() => {
    controllerRef.current?.setPrecision(precision, minMove);
  }, [precision, minMove]);

  return (
    <div className="absolute inset-0" data-slot="lightweight-chart">
      <div ref={containerRef} role="img" aria-label={summary} className="absolute inset-0" />
      <TickFeeder
        instrumentKey={instrumentKey}
        onTick={(tick) => {
          const delta =
            tick.vol !== null && lastVolume.current !== null ? Math.max(0, tick.vol - lastVolume.current) : 0;
          lastVolume.current = tick.vol;
          latestTick.current = tick;
          controllerRef.current?.applyTick(toLiveTick(tick, delta));
        }}
      />
    </div>
  );
}

/** Renders nothing: forwards each new tick of the instrument to the chart (≤ 10 a second, coalesced by the store). */
function TickFeeder({ instrumentKey, onTick }: { instrumentKey: string; onTick: (tick: Tick) => void }) {
  const tick = useTick(instrumentKey);
  const handler = useRef(onTick);
  useLayoutEffect(() => {
    handler.current = onTick;
  });
  useEffect(() => {
    if (tick !== undefined) handler.current(tick);
  }, [tick]);
  return null;
}
