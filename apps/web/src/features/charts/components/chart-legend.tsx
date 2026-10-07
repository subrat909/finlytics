"use client";

import { Eye, EyeOff, Settings2, X } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { useIsStale, useTick } from "@/features/realtime/hooks/use-realtime";

import type { LegendSnapshot, PaneBox } from "../lib/chart/controller";
import { directionOf, formatCompact, formatNumber, formatPercent } from "../lib/format";
import { INDICATORS, describeInputs, placementOf } from "../lib/indicators/registry";
import type { IndicatorInstance } from "../lib/indicators/registry";
import { INTERVALS } from "../schemas";
import { useWorkspace } from "../store/workspace-store";

import { useChartController, useChartInfo } from "./chart-context";
import { SimulatedBadge, TOKEN_TEXT, focusRing } from "./ui";

const EMPTY_LEGEND: LegendSnapshot = { bar: null, previousClose: null, hovering: false, values: {} };
const EMPTY_PANES: readonly PaneBox[] = [];
const noSubscription = () => () => undefined;

function useLegend(): LegendSnapshot {
  const controller = useChartController();
  return useSyncExternalStore(
    controller?.subscribeLegend ?? noSubscription,
    controller?.getLegend ?? (() => EMPTY_LEGEND),
    () => EMPTY_LEGEND,
  );
}

function usePanes(): readonly PaneBox[] {
  const controller = useChartController();
  return useSyncExternalStore(
    controller?.subscribePanes ?? noSubscription,
    controller?.getPanes ?? (() => EMPTY_PANES),
    () => EMPTY_PANES,
  );
}

const GLYPH = { up: "▲", down: "▼", flat: "" } as const;

/** The feed's state for this instrument: a green dot while ticks flow, grey once stale or before any. */
function LiveDot({ instrumentKey }: { instrumentKey: string }) {
  const tick = useTick(instrumentKey);
  const stale = useIsStale(instrumentKey);
  const live = tick !== undefined && !stale;
  return (
    <span
      data-slot="live-dot"
      data-live={live}
      className="inline-flex items-center"
      title={live ? "Live" : "No update for over 5 s"}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", live ? "bg-profit" : "bg-fg-muted")} />
      <span className="sr-only">{live ? "Live" : tick === undefined ? "No live price yet" : "Stale"}</span>
    </span>
  );
}

/** Speaks the price at most every 30 s (frontend.md: throttled `aria-live` for prices). */
function PriceAnnouncer({
  instrumentKey,
  symbol,
  precision,
}: {
  instrumentKey: string;
  symbol: string;
  precision: number;
}) {
  const tick = useTick(instrumentKey);
  const ref = useRef<HTMLParagraphElement>(null);
  const spokenAt = useRef(0);
  useEffect(() => {
    if (tick === undefined || ref.current === null || tick.receivedAt - spokenAt.current < 30_000) return;
    spokenAt.current = tick.receivedAt;
    ref.current.textContent = `${symbol} ${formatNumber(tick.ltp, precision)}`;
  }, [tick, symbol, precision]);
  return <p ref={ref} aria-live="polite" className="sr-only" data-slot="live-price-announcer" />;
}

function formatValue(instance: IndicatorInstance, value: number | null | undefined, precision: number): string {
  const format = INDICATORS[instance.kind].format;
  if (format === "volume") return formatCompact(value);
  return formatNumber(value, format === "decimal" ? 2 : precision);
}

interface RowProps {
  instance: IndicatorInstance;
  values: Readonly<Record<string, number | null>> | undefined;
  precision: number;
  /** For the volume histogram's colour: the bar's direction. */
  barUp: boolean;
}

const IndicatorRow = memo(function IndicatorRow({ instance, values, precision, barUp }: RowProps) {
  const toggleIndicator = useWorkspace((state) => state.toggleIndicator);
  const removeIndicator = useWorkspace((state) => state.removeIndicator);
  const editIndicator = useWorkspace((state) => state.editIndicator);
  const definition = INDICATORS[instance.kind];
  const params = describeInputs(instance);
  const name = `${definition.short}${params === "" ? "" : ` ${params}`}`;
  const buttonClasses = cn(
    "inline-flex size-6 cursor-pointer items-center justify-center rounded-sm text-fg-muted transition-[color,background-color]",
    "hover:bg-surface-3 hover:text-fg [&_svg]:size-3.5",
    focusRing,
  );

  return (
    <li
      data-slot="indicator-legend"
      data-indicator={instance.kind}
      className="group pointer-events-auto flex h-6 w-fit max-w-full items-center gap-2 rounded-sm bg-surface-1/80 px-1 text-xs"
    >
      <span className={cn("shrink-0", instance.hidden ? "text-fg-muted line-through" : "text-fg")}>{name}</span>
      {instance.hidden
        ? null
        : definition.plots.map((plot) => {
            const value = values?.[plot.key];
            const token = instance.styles[plot.key]?.color ?? plot.color;
            let color = TOKEN_TEXT[token];
            if (plot.colorBy === "direction") color = barUp ? "text-profit" : "text-loss";
            if (plot.colorBy === "sign") color = (value ?? 0) >= 0 ? "text-profit" : "text-loss";
            return (
              <span key={plot.key} className={cn("tabular", color)}>
                <span className="sr-only">{plot.label} </span>
                {formatValue(instance, value, precision)}
              </span>
            );
          })}
      <span className="flex items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <button
          type="button"
          aria-label={instance.hidden ? `Show ${name}` : `Hide ${name}`}
          className={buttonClasses}
          onClick={() => {
            toggleIndicator(instance.id);
          }}
        >
          {instance.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
        <button
          type="button"
          aria-label={`${name} settings`}
          className={buttonClasses}
          onClick={() => {
            editIndicator(instance.id);
          }}
        >
          <Settings2 aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Remove ${name}`}
          className={cn(buttonClasses, "hover:text-loss")}
          onClick={() => {
            removeIndicator(instance.id);
          }}
        >
          <X aria-hidden="true" />
        </button>
      </span>
    </li>
  );
});

/** An oscillator's legend at the top of its pane (positioned from the chart's pane layout). */
function PaneLegend({ top, children }: { top: number; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  // Layout, not style: set on the node (frontend.md: no inline style props).
  useLayoutEffect(() => {
    if (ref.current !== null) ref.current.style.top = `${String(Math.round(top + 4))}px`;
  }, [top]);
  return (
    <ul ref={ref} aria-label="Pane indicator" className="pointer-events-none absolute left-2 flex flex-col gap-0.5">
      {children}
    </ul>
  );
}

export interface ChartLegendProps {
  simulated: boolean;
}

/**
 * TradingView's legend: symbol, interval and exchange with the live dot, the OHLC and change of the bar under the
 * crosshair (the latest bar otherwise), and a row per indicator with its values and hide, settings and remove buttons.
 * Oscillators label their own pane. Values come from the chart engine through an external store, so moving the
 * crosshair re-renders the legend only.
 */
export function ChartLegend({ simulated }: ChartLegendProps) {
  const info = useChartInfo();
  const interval = useWorkspace((state) => state.interval);
  const instances = useWorkspace((state) => state.indicators);
  const settings = useWorkspace((state) => state.settings);
  const legend = useLegend();
  const panes = usePanes();
  const { bar, previousClose } = legend;
  const precision = info.precision;
  const change = bar === null || previousClose === null ? null : bar.close - previousClose;
  const percent =
    change === null || previousClose === null || previousClose === 0 ? null : (change / previousClose) * 100;
  const direction = directionOf(change);
  const barUp = bar === null || bar.close >= bar.open;
  const tone = barUp ? "text-profit" : "text-loss";
  // Settings → Status line decides what the legend shows.
  const priceRows = instances.filter((instance) => {
    const placement = placementOf(instance);
    if (placement === "pane") return false;
    return placement === "volume" ? settings.legendVolume : settings.legendIndicators;
  });
  const paneRows = instances.filter((instance) => placementOf(instance) === "pane");

  return (
    <div data-slot="chart-legend" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div className="absolute top-2 left-2 flex max-w-[calc(100%-5rem)] flex-col gap-0.5">
        <div className="flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm bg-surface-1/80 px-1 text-[13px]">
          <LiveDot instrumentKey={info.instrumentKey} />
          <h1 className="font-semibold text-fg">
            {info.symbol} <span className="sr-only">chart</span>
          </h1>
          <span aria-hidden="true" className="text-fg-muted">
            ·
          </span>
          <span className="text-fg-muted">{INTERVALS[interval].short}</span>
          <span aria-hidden="true" className="text-fg-muted">
            ·
          </span>
          <span className="text-fg-muted">{info.exchange}</span>
          {simulated ? <SimulatedBadge /> : null}
        </div>
        {settings.legendOhlc || settings.legendChange ? (
          <dl
            data-slot="legend-ohlc"
            data-hovering={legend.hovering}
            className="flex w-fit max-w-full flex-wrap items-center gap-x-2.5 rounded-sm bg-surface-1/80 px-1 text-xs"
          >
            {(settings.legendOhlc
              ? ([
                  ["O", "Open", bar?.open],
                  ["H", "High", bar?.high],
                  ["L", "Low", bar?.low],
                  ["C", "Close", bar?.close],
                ] as const)
              : []
            ).map(([short, long, value]) => (
              <div key={short} className="flex items-center gap-1">
                <dt className="text-fg-muted">
                  <abbr title={long} className="no-underline">
                    {short}
                  </abbr>
                </dt>
                <dd className={cn("tabular", bar === null ? "text-fg-muted" : tone)}>
                  {formatNumber(value, precision)}
                </dd>
              </div>
            ))}
            {settings.legendChange ? (
              <div className="flex items-center gap-1">
                <dt className="sr-only">Change</dt>
                <dd
                  className={cn(
                    "tabular",
                    direction === "up" ? "text-profit" : direction === "down" ? "text-loss" : "text-fg-muted",
                  )}
                >
                  {direction === "flat" ? null : (
                    <span aria-hidden="true" className="mr-0.5 text-[0.7em]">
                      {GLYPH[direction]}
                    </span>
                  )}
                  {formatNumber(change, precision, "always")} ({formatPercent(percent)})
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {priceRows.length > 0 ? (
          <ul aria-label="Indicators on the price chart" className="flex flex-col gap-0.5">
            {priceRows.map((instance) => (
              <IndicatorRow
                key={instance.id}
                instance={instance}
                values={legend.values[instance.id]}
                precision={precision}
                barUp={barUp}
              />
            ))}
          </ul>
        ) : null}
      </div>
      {paneRows.map((instance, index) => {
        const pane = panes[index + 1];
        if (pane === undefined || !settings.legendIndicators) return null;
        return (
          <PaneLegend key={instance.id} top={pane.top}>
            <IndicatorRow instance={instance} values={legend.values[instance.id]} precision={precision} barUp={barUp} />
          </PaneLegend>
        );
      })}
      <PriceAnnouncer instrumentKey={info.instrumentKey} symbol={info.symbol} precision={precision} />
    </div>
  );
}
