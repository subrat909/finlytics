/**
 * The chart engine: one Lightweight Charts v5 chart with the main series (any chart type), indicators (price-pane
 * overlays, the volume histogram and their own panes), drawings (a series primitive), the live last bar, the crosshair
 * legend and older-history paging. Plain TypeScript, no React: the workspace feeds it state and listens to it, so a
 * tick or a mouse move never re-renders React. `destroy()` removes the chart, its listeners, observers and frames.
 */
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
} from "lightweight-charts";
import type {
  ChartOptions,
  DeepPartial,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  Logical,
  LogicalRange,
  MouseEventParams,
  PriceFormat,
  SeriesType,
  UTCTimestamp,
} from "lightweight-charts";

import { INTERVALS } from "../../schemas";
import type { ChartInterval, ChartSettings, ChartType, ScaleMode } from "../../schemas";
import { mergeTick } from "../bars";
import type { Bar, LiveTick, Session } from "../bars";
import type { ScreenPoint } from "../drawings/geometry";
import type { AnchorPoint, Drawing, DrawingKind, DrawingTool } from "../drawings/types";
import { heikinAshi, heikinAshiBar } from "../heikin-ashi";
import type { Series } from "../indicators/core";
import { INDICATORS, placementOf } from "../indicators/registry";
import type { IndicatorDefinition, IndicatorInstance } from "../indicators/registry";
import type { ChartColors } from "../theme-colors";
import { withAlpha } from "../theme-colors";
import { dayStart } from "../time";

import { DrawingInteraction } from "./drawing-interaction";
import { DrawingsPrimitive } from "./drawings-primitive";
import type { DrawingProjection } from "./drawings-primitive";
import { logicalToTime, snapToBar, timeToLogical } from "./projection";
import { baselineLevel, mainPoint, mainPoints, plotPoint, plotPoints } from "./series-data";

export interface LegendSnapshot {
  /** The bar under the crosshair, else the last bar (as drawn: Heikin Ashi on that chart type). */
  bar: Bar | null;
  previousClose: number | null;
  hovering: boolean;
  /** Indicator values at that bar: instance id → plot key → value. */
  values: Readonly<Record<string, Readonly<Record<string, number | null>>>>;
}

export interface PaneBox {
  top: number;
  height: number;
}

export interface ControllerCallbacks {
  /** The view reached the oldest loaded bars: load older history. */
  onNeedOlder(): void;
  onDrawingCommit(drawings: Drawing[], selectedId: string | null): void;
  onDrawingSelect(id: string | null): void;
  onDrawingPlaced(kind: DrawingKind): void;
  onTextRequest(request: { point: AnchorPoint } | { id: string }): void;
  /** The user dragged the price scale (auto-scale off) or double-clicked it (back on). */
  onAutoScaleChange(autoScale: boolean): void;
}

export interface ControllerState {
  colors: ChartColors;
  fontFamily: string;
  settings: ChartSettings;
  chartType: ChartType;
  scaleMode: ScaleMode;
  autoScale: boolean;
  precision: number;
  minMove: number;
  interval: ChartInterval;
  session: Session;
}

export type DataMode = "reset" | "keep";

interface IndicatorRuntime {
  instance: IndicatorInstance;
  definition: IndicatorDefinition;
  series: Map<string, ISeriesApi<SeriesType>>;
  values: Readonly<Record<string, Series>>;
  priceLines: { series: ISeriesApi<SeriesType>; line: IPriceLine }[];
}

/** Bars from the left edge that trigger loading older history. */
const PAGE_AHEAD_BARS = 40;
const MAIN_PANE_STRETCH = 3;

/** The crosshair for a tool: the arrow hides it, drawing tools use the plain one, the crosshair follows settings. */
function crosshairMode(tool: DrawingTool, settings: ChartSettings): CrosshairMode {
  if (tool === "cursor") return CrosshairMode.Hidden;
  if (tool !== "crosshair") return CrosshairMode.Normal;
  return settings.crosshair === "magnet" ? CrosshairMode.Magnet : CrosshairMode.Normal;
}

function chartOptions(state: ControllerState, tool: DrawingTool): DeepPartial<ChartOptions> {
  const { colors, fontFamily, settings, interval } = state;
  const crosshairLine = {
    color: colors.crosshair,
    labelBackgroundColor: colors.crosshairLabel,
    style: LineStyle.Dashed,
    width: 1 as const,
  };
  return {
    layout: {
      background: { type: ColorType.Solid, color: colors.background },
      textColor: colors.text,
      fontFamily,
      fontSize: 11,
      // The built-in logo injects an unnonced <style> (blocked by the CSP); the bottom bar links TradingView instead.
      attributionLogo: false,
      panes: { separatorColor: colors.border, separatorHoverColor: withAlpha(colors.text, 0.2), enableResize: true },
    },
    grid: {
      vertLines: { visible: settings.gridVertical, color: colors.grid },
      horzLines: { visible: settings.gridHorizontal, color: colors.grid },
    },
    rightPriceScale: { borderColor: colors.border },
    timeScale: {
      borderColor: colors.border,
      timeVisible: INTERVALS[interval].intraday,
      secondsVisible: false,
      rightOffset: 6,
    },
    crosshair: {
      mode: crosshairMode(tool, settings),
      vertLine: crosshairLine,
      horzLine: crosshairLine,
    },
  };
}

function priceFormat(state: ControllerState, format: IndicatorDefinition["format"] | "main"): PriceFormat {
  if (format === "volume") return { type: "volume", precision: 0, minMove: 1 };
  if (format === "decimal") return { type: "price", precision: 2, minMove: 0.01 };
  return { type: "price", precision: state.precision, minMove: state.minMove };
}

const SCALE_MODES: Readonly<Record<ScaleMode, PriceScaleMode>> = {
  normal: PriceScaleMode.Normal,
  log: PriceScaleMode.Logarithmic,
  percent: PriceScaleMode.Percentage,
};

export class ChartController {
  readonly chart: IChartApi;
  private state: ControllerState;
  private main: ISeriesApi<SeriesType>;
  private source: Bar[] = [];
  private bars: Bar[] = [];
  /** What the main series shows: `bars`, or their Heikin Ashi form. */
  private shown: Bar[] = [];
  private liveBars = new Map<number, Bar>();
  private liveDay: Bar | undefined;
  private indicators: IndicatorRuntime[] = [];
  private instances: readonly IndicatorInstance[] = [];
  private readonly primitive: DrawingsPrimitive;
  private readonly interaction: DrawingInteraction;
  private tool: DrawingTool = "crosshair";
  private hoverIndex: number | null = null;
  private dirtyFrom: number | null = null;
  private frame = 0;
  private layoutFrame = 0;
  private olderRequested = false;
  private legend: LegendSnapshot = { bar: null, previousClose: null, hovering: false, values: {} };
  private panes: PaneBox[] = [];
  private readonly legendListeners = new Set<() => void>();
  private readonly paneListeners = new Set<() => void>();
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;

  constructor(
    private readonly container: HTMLElement,
    initial: ControllerState,
    private readonly callbacks: ControllerCallbacks,
  ) {
    this.state = initial;
    this.chart = createChart(container, { autoSize: true, ...chartOptions(initial, this.tool) });
    this.chart.panes()[0]?.setPreserveEmptyPane(true);
    this.main = this.createMain(initial.chartType);
    this.applyScale();

    const projection: DrawingProjection = {
      timeToX: (time) => this.timeToX(time),
      priceToY: (price) => this.main.priceToCoordinate(price),
      barsBetween: (from, to) => {
        const a = timeToLogical(this.shown, this.period, from);
        const b = timeToLogical(this.shown, this.period, to);
        return a === null || b === null ? 0 : b - a;
      },
      paneSize: () => this.chart.paneSize(0),
      dayStarts: () => this.dayStarts(),
    };
    this.primitive = new DrawingsPrimitive(
      {
        drawings: [],
        draft: null,
        selectedId: null,
        hoveredId: null,
        hidden: false,
        locked: false,
        creating: false,
        sessionBreaks: initial.settings.sessionBreaks,
        intraday: INTERVALS[initial.interval].intraday,
        precision: initial.precision,
        colors: initial.colors,
        fontFamily: initial.fontFamily,
      },
      projection,
    );
    this.main.attachPrimitive(this.primitive);
    this.interaction = new DrawingInteraction(
      container,
      {
        local: (event, clamp) => this.localPoint(event, clamp ?? false),
        toChart: (point, magnet) => this.toChart(point, magnet),
        setChartInteractive: (enabled) => {
          this.chart.applyOptions({ handleScroll: enabled, handleScale: enabled });
        },
      },
      this.primitive,
      {
        onCommit: (drawings, selectedId) => {
          callbacks.onDrawingCommit(drawings, selectedId);
        },
        onSelect: (id) => {
          callbacks.onDrawingSelect(id);
        },
        onPlaced: (kind) => {
          callbacks.onDrawingPlaced(kind);
        },
        onTextRequest: (request) => {
          callbacks.onTextRequest(request);
        },
      },
    );

    const onCrosshair = (param: MouseEventParams) => {
      const index = param.point === undefined || param.logical === undefined ? null : Math.round(param.logical);
      this.hoverIndex = index !== null && index >= 0 && index < this.shown.length ? index : null;
      this.scheduleFrame();
    };
    this.chart.subscribeCrosshairMove(onCrosshair);
    const onRange = (range: LogicalRange | null) => {
      if (range === null || this.olderRequested || this.bars.length === 0) return;
      if (range.from < PAGE_AHEAD_BARS) {
        this.olderRequested = true;
        callbacks.onNeedOlder();
      }
    };
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    // Dragging the price scale turns auto-scale off (and double-clicking it back on): mirror that in the toolbar.
    const syncAutoScale = () => {
      const autoScale = this.chart.priceScale("right").options().autoScale;
      if (autoScale !== this.state.autoScale) {
        this.state = { ...this.state, autoScale };
        callbacks.onAutoScaleChange(autoScale);
      }
    };
    container.addEventListener("pointerup", syncAutoScale);
    container.addEventListener("dblclick", syncAutoScale);
    this.cleanups.push(() => {
      this.chart.unsubscribeCrosshairMove(onCrosshair);
      this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      container.removeEventListener("pointerup", syncAutoScale);
      container.removeEventListener("dblclick", syncAutoScale);
    });

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleLayout();
      });
      this.resizeObserver.observe(container);
    }
    this.scheduleLayout();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Subscriptions for React (useSyncExternalStore)

  subscribeLegend = (listener: () => void): (() => void) => {
    this.legendListeners.add(listener);
    return () => {
      this.legendListeners.delete(listener);
    };
  };

  getLegend = (): LegendSnapshot => this.legend;

  subscribePanes = (listener: () => void): (() => void) => {
    this.paneListeners.add(listener);
    return () => {
      this.paneListeners.delete(listener);
    };
  };

  getPanes = (): readonly PaneBox[] => this.panes;

  // -------------------------------------------------------------------------------------------------------------------
  // Data

  private get period(): number {
    return INTERVALS[this.state.interval].seconds;
  }

  /**
   * Replaces the bars. `keep` (older history arrived, same interval) keeps the view and the live bars built from
   * ticks after the last complete bar; `reset` (another interval or instrument) starts over at the latest bar.
   */
  setData(source: readonly Bar[], display: readonly Bar[], interval: ChartInterval, session: Session, mode: DataMode) {
    const intervalChanged = interval !== this.state.interval;
    this.state = { ...this.state, interval, session };
    // Bars built from ticks survive older history arriving; another interval starts over.
    if (intervalChanged) {
      this.liveBars.clear();
      this.liveDay = undefined;
    }
    const bars = [...display];
    for (const live of [...this.liveBars.values()].sort((a, b) => a.time - b.time)) {
      const last = bars.at(-1);
      if (last === undefined || live.time > last.time) bars.push(live);
      else if (live.time === last.time) {
        bars[bars.length - 1] = {
          ...last,
          high: Math.max(last.high, live.high),
          low: Math.min(last.low, live.low),
          close: live.close,
          volume: Math.max(last.volume, live.volume),
        };
      }
    }
    this.source = [...source];
    this.bars = bars;
    this.olderRequested = false;
    this.redrawMain();
    this.recomputeIndicators(true);
    this.chart.applyOptions({ timeScale: { timeVisible: INTERVALS[interval].intraday } });
    this.primitive.update({ intraday: INTERVALS[interval].intraday });
    if (mode === "reset" || intervalChanged) this.chart.timeScale().scrollToRealTime();
    this.emitLegend();
  }

  /** After an older-history request settled (with or without bars), scrolling left may ask again. */
  resetPaging(): void {
    this.olderRequested = false;
  }

  /** One tick on the last bar (or a new one); indicators and the legend follow on the next frame. */
  applyTick(tick: LiveTick): void {
    const update = mergeTick(this.bars, tick, {
      interval: this.state.interval,
      session: this.state.session,
      dailySource: this.source,
      liveDay: this.liveDay,
    });
    if (update === null) return;
    if (update.liveDay !== undefined) this.liveDay = update.liveDay;
    const { bar } = update;
    if (update.replace) this.bars[this.bars.length - 1] = bar;
    else this.bars.push(bar);
    this.liveBars.set(bar.time, bar);
    const index = this.bars.length - 1;

    if (this.state.chartType === "heikin-ashi") {
      const shownBar = heikinAshiBar(bar, this.shown[index - 1]);
      if (update.replace) this.shown[index] = shownBar;
      else this.shown.push(shownBar);
    } else {
      this.shown = this.bars;
    }
    const shownBar = this.shown[index];
    if (shownBar !== undefined) {
      this.main.update(mainPoint(this.state.chartType, shownBar, this.shown[index - 1], this.state.colors));
    }
    this.dirtyFrom = Math.min(this.dirtyFrom ?? index, index);
    this.scheduleFrame();
  }

  private redrawMain(): void {
    this.shown = this.state.chartType === "heikin-ashi" ? heikinAshi(this.bars) : this.bars;
    if (this.state.chartType === "baseline") {
      this.main.applyOptions({ baseValue: { type: "price", price: baselineLevel(this.bars) } });
    }
    this.main.setData(mainPoints(this.state.chartType, this.shown, this.state.colors));
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Main series and options

  private createMain(type: ChartType): ISeriesApi<SeriesType> {
    const { colors, settings } = this.state;
    const common = {
      priceLineVisible: settings.priceLine,
      lastValueVisible: true,
      priceFormat: priceFormat(this.state, "main"),
    };
    const { up, down } = colors;
    const primary = colors.palette.primary;
    let series: ISeriesApi<SeriesType>;
    switch (type) {
      case "bars":
        series = this.chart.addSeries(BarSeries, { ...common, upColor: up, downColor: down, thinBars: false }, 0);
        break;
      case "line":
        series = this.chart.addSeries(LineSeries, { ...common, color: primary, lineWidth: 2 }, 0);
        break;
      case "area":
        series = this.chart.addSeries(
          AreaSeries,
          {
            ...common,
            lineColor: primary,
            lineWidth: 2,
            topColor: withAlpha(primary, 0.28),
            bottomColor: withAlpha(primary, 0.02),
          },
          0,
        );
        break;
      case "baseline":
        series = this.chart.addSeries(
          BaselineSeries,
          {
            ...common,
            baseValue: { type: "price", price: baselineLevel(this.bars) },
            lineWidth: 2,
            topLineColor: up,
            topFillColor1: withAlpha(up, 0.28),
            topFillColor2: withAlpha(up, 0.04),
            bottomLineColor: down,
            bottomFillColor1: withAlpha(down, 0.04),
            bottomFillColor2: withAlpha(down, 0.28),
          },
          0,
        );
        break;
      case "hollow":
        series = this.chart.addSeries(
          CandlestickSeries,
          {
            ...common,
            upColor: up,
            downColor: down,
            borderVisible: true,
            borderUpColor: up,
            borderDownColor: down,
            wickUpColor: up,
            wickDownColor: down,
          },
          0,
        );
        break;
      case "candles":
      case "heikin-ashi":
        series = this.chart.addSeries(
          CandlestickSeries,
          { ...common, upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down },
          0,
        );
        break;
    }
    return series;
  }

  setChartType(type: ChartType): void {
    if (type === this.state.chartType) return;
    this.state = { ...this.state, chartType: type };
    this.rebuildMain();
    this.emitLegend();
  }

  /** A new main series for the chart type (and colours), keeping the drawings, scale and data. */
  private rebuildMain(): void {
    this.main.detachPrimitive(this.primitive);
    this.chart.removeSeries(this.main);
    this.main = this.createMain(this.state.chartType);
    // Indicators draw over the price series, as on TradingView.
    this.main.setSeriesOrder(0);
    this.main.attachPrimitive(this.primitive);
    this.applyScale();
    this.applyMainMargins();
    this.redrawMain();
  }

  setScale(scaleMode: ScaleMode, autoScale: boolean): void {
    this.state = { ...this.state, scaleMode, autoScale };
    this.applyScale();
  }

  private applyScale(): void {
    this.chart.priceScale("right").applyOptions({
      mode: SCALE_MODES[this.state.scaleMode],
      autoScale: this.state.autoScale,
    });
  }

  setSettings(settings: ChartSettings): void {
    const priceLineChanged = settings.priceLine !== this.state.settings.priceLine;
    this.state = { ...this.state, settings };
    this.chart.applyOptions(chartOptions(this.state, this.tool));
    if (priceLineChanged) this.main.applyOptions({ priceLineVisible: settings.priceLine });
    this.primitive.update({ sessionBreaks: settings.sessionBreaks });
  }

  /** New token colours (theme switch): the chart, the series, the indicators and the drawings. */
  setColors(colors: ChartColors, fontFamily: string): void {
    this.state = { ...this.state, colors, fontFamily };
    this.chart.applyOptions(chartOptions(this.state, this.tool));
    this.rebuildMain();
    this.buildIndicators(this.instances);
    this.primitive.update({ colors, fontFamily });
    this.emitLegend();
  }

  setPrecision(precision: number, minMove: number): void {
    if (precision === this.state.precision && minMove === this.state.minMove) return;
    this.state = { ...this.state, precision, minMove };
    this.main.applyOptions({ priceFormat: priceFormat(this.state, "main") });
    for (const runtime of this.indicators) {
      if (runtime.definition.format !== "price") continue;
      for (const series of runtime.series.values())
        series.applyOptions({ priceFormat: priceFormat(this.state, "price") });
    }
    this.primitive.update({ precision });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Indicators

  /** Rebuilds the indicator series when instances change (hiding only toggles visibility). */
  setIndicators(instances: readonly IndicatorInstance[]): void {
    const structure = (list: readonly IndicatorInstance[]) =>
      JSON.stringify(list.map(({ id, kind, inputs, styles }) => ({ id, kind, inputs, styles })));
    if (structure(instances) === structure(this.instances)) {
      this.instances = instances;
      for (const runtime of this.indicators) {
        const instance = instances.find((candidate) => candidate.id === runtime.instance.id);
        if (instance === undefined) continue;
        runtime.instance = instance;
        for (const series of runtime.series.values()) series.applyOptions({ visible: !instance.hidden });
      }
      return;
    }
    this.buildIndicators(instances);
    this.emitLegend();
  }

  private removeIndicators(): void {
    for (const runtime of this.indicators) {
      for (const { series, line } of runtime.priceLines) series.removePriceLine(line);
      for (const series of runtime.series.values()) this.chart.removeSeries(series);
    }
    this.indicators = [];
    // Emptied panes go with their series; this removes any the chart kept.
    for (let index = this.chart.panes().length - 1; index > 0; index -= 1) {
      if ((this.chart.panes()[index]?.getSeries().length ?? 0) === 0) this.chart.removePane(index);
    }
  }

  private buildIndicators(instances: readonly IndicatorInstance[]): void {
    this.removeIndicators();
    this.instances = instances;
    const { colors } = this.state;
    let pane = 1;
    for (const instance of instances) {
      const definition = INDICATORS[instance.kind];
      const placement = placementOf(instance);
      const paneIndex = placement === "pane" ? pane++ : 0;
      const runtime: IndicatorRuntime = {
        instance,
        definition,
        series: new Map(),
        values: definition.compute(this.bars, instance.inputs),
        priceLines: [],
      };
      for (const plot of definition.plots) {
        const style = instance.styles[plot.key] ?? { color: plot.color, width: plot.width ?? 1 };
        const color = colors.palette[style.color];
        const base = {
          visible: !instance.hidden,
          priceLineVisible: false,
          lastValueVisible: placement !== "volume",
          priceFormat: priceFormat(this.state, definition.format),
          ...(placement === "volume" ? { priceScaleId: "volume" } : {}),
        };
        const series =
          plot.style === "histogram"
            ? this.chart.addSeries(HistogramSeries, { ...base, color }, paneIndex)
            : this.chart.addSeries(
                LineSeries,
                {
                  ...base,
                  color,
                  lineWidth: style.width,
                  lineVisible: plot.style === "line",
                  pointMarkersVisible: plot.style === "dots",
                  pointMarkersRadius: 1.5,
                  crosshairMarkerVisible: plot.style === "line",
                },
                paneIndex,
              );
        if (placement === "volume") series.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        series.setData(plotPoints(plot, this.bars, runtime.values[plot.key], colors, color));
        runtime.series.set(plot.key, series);
      }
      const first = runtime.series.values().next().value;
      if (first !== undefined) {
        for (const level of definition.levels ?? []) {
          const line = first.createPriceLine({
            price: level,
            color: withAlpha(colors.text, 0.6),
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: "",
          });
          runtime.priceLines.push({ series: first, line });
        }
      }
      this.indicators.push(runtime);
    }
    const panes = this.chart.panes();
    panes[0]?.setStretchFactor(MAIN_PANE_STRETCH);
    for (const extra of panes.slice(1)) extra.setStretchFactor(1);
    this.applyMainMargins();
    this.scheduleLayout();
  }

  /** Room at the bottom of the price pane for the volume histogram when it is there. */
  private applyMainMargins(): void {
    const volume = this.indicators.some((runtime) => placementOf(runtime.instance) === "volume");
    this.chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: volume ? 0.2 : 0.08 } });
  }

  private recomputeIndicators(full: boolean): void {
    const from = full ? 0 : (this.dirtyFrom ?? this.bars.length - 1);
    for (const runtime of this.indicators) {
      runtime.values = runtime.definition.compute(this.bars, runtime.instance.inputs);
      for (const plot of runtime.definition.plots) {
        const series = runtime.series.get(plot.key);
        if (series === undefined) continue;
        const style = runtime.instance.styles[plot.key];
        const color = this.state.colors.palette[style?.color ?? plot.color];
        const values = runtime.values[plot.key];
        if (full) {
          series.setData(plotPoints(plot, this.bars, values, this.state.colors, color));
          continue;
        }
        for (let index = Math.max(0, from); index < this.bars.length; index += 1) {
          const bar = this.bars[index];
          if (bar === undefined) continue;
          series.update(plotPoint(plot, bar, values?.[index], this.state.colors, color), index < this.bars.length - 1);
        }
      }
    }
    this.dirtyFrom = null;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Drawings

  setDrawings(patch: { drawings: readonly Drawing[]; selectedId: string | null; hidden: boolean; locked: boolean }) {
    this.primitive.update(patch);
  }

  setTool(tool: DrawingTool): void {
    this.tool = tool;
    this.interaction.setTool(tool);
    this.chart.applyOptions({ crosshair: { mode: crosshairMode(tool, this.state.settings) } });
  }

  setMagnet(magnet: boolean): void {
    this.interaction.setMagnet(magnet);
  }

  /** Esc: drops a drawing in progress. */
  cancelDrawing(): boolean {
    return this.interaction.cancel();
  }

  private timeToX(time: number): number | null {
    const logical = timeToLogical(this.shown, this.period, time);
    return logical === null ? null : this.chart.timeScale().logicalToCoordinate(logical as Logical);
  }

  private localPoint(event: PointerEvent | MouseEvent, clamp: boolean): ScreenPoint | null {
    const row = this.chart.panes()[0]?.getHTMLElement();
    if (row === null || row === undefined) return null;
    const rect = row.getBoundingClientRect();
    const size = this.chart.paneSize(0);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (clamp) return { x: Math.min(Math.max(x, 0), size.width), y: Math.min(Math.max(y, 0), size.height) };
    return x >= 0 && x < size.width && y >= 0 && y < size.height ? { x, y } : null;
  }

  private toChart(point: ScreenPoint, magnet: boolean): AnchorPoint | null {
    const logical = this.chart.timeScale().coordinateToLogical(point.x);
    const raw = this.main.coordinateToPrice(point.y);
    if (logical === null || raw === null) return null;
    const time = logicalToTime(this.shown, this.period, logical);
    if (time === null) return null;
    const price = magnet ? snapToBar(this.shown[Math.round(logical)], raw) : raw;
    return { time, price };
  }

  private dayStarts(): number[] {
    const range = this.chart.timeScale().getVisibleLogicalRange();
    if (range === null) return [];
    const result: number[] = [];
    const from = Math.max(1, Math.floor(range.from));
    const to = Math.min(this.shown.length - 1, Math.ceil(range.to));
    for (let index = from; index <= to; index += 1) {
      const bar = this.shown[index];
      const previous = this.shown[index - 1];
      if (bar === undefined || previous === undefined || dayStart(bar.time) === dayStart(previous.time)) continue;
      const a = this.chart.timeScale().logicalToCoordinate((index - 1) as Logical);
      const b = this.chart.timeScale().logicalToCoordinate(index as Logical);
      if (a !== null && b !== null) result.push((a + b) / 2);
    }
    return result;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // View

  /** Shows `[from, to]` (chart times); `from` before the first bar shows everything. */
  setVisibleRange(from: number, to: number): void {
    const first = this.shown[0];
    if (first === undefined) return;
    if (from <= first.time) {
      this.chart.timeScale().fitContent();
      return;
    }
    this.chart.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
  }

  scrollToRealTime(): void {
    this.chart.timeScale().scrollToRealTime();
  }

  /** The chart as a PNG-ready canvas, drawings included. */
  screenshot(): HTMLCanvasElement {
    return this.chart.takeScreenshot(true, false);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Legend and layout

  private scheduleFrame(): void {
    if (this.frame !== 0 || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.destroyed) return;
      if (this.dirtyFrom !== null) this.recomputeIndicators(false);
      this.emitLegend();
    });
  }

  private emitLegend(): void {
    const index = this.hoverIndex ?? this.shown.length - 1;
    const bar = this.shown[index] ?? null;
    const values: Record<string, Record<string, number | null>> = {};
    for (const runtime of this.indicators) {
      values[runtime.instance.id] = Object.fromEntries(
        runtime.definition.plots.map((plot) => [plot.key, runtime.values[plot.key]?.[index] ?? null]),
      );
    }
    this.legend = {
      bar,
      previousClose: this.shown[index - 1]?.close ?? null,
      hovering: this.hoverIndex !== null,
      values,
    };
    for (const listener of this.legendListeners) listener();
  }

  private scheduleLayout(): void {
    if (this.layoutFrame !== 0 || this.destroyed) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0;
      if (this.destroyed) return;
      this.measurePanes();
    });
  }

  private measurePanes(): void {
    const origin = this.container.getBoundingClientRect();
    const boxes: PaneBox[] = [];
    for (const pane of this.chart.panes()) {
      const element = pane.getHTMLElement();
      if (element === null) continue;
      this.resizeObserver?.observe(element);
      const rect = element.getBoundingClientRect();
      boxes.push({ top: rect.top - origin.top, height: rect.height });
    }
    const same =
      boxes.length === this.panes.length &&
      boxes.every((box, index) => {
        const known = this.panes[index];
        return known !== undefined && box.top === known.top && box.height === known.height;
      });
    if (same) return;
    this.panes = boxes;
    for (const listener of this.paneListeners) listener();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    if (this.layoutFrame !== 0) cancelAnimationFrame(this.layoutFrame);
    this.resizeObserver?.disconnect();
    this.interaction.dispose();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.legendListeners.clear();
    this.paneListeners.clear();
    this.chart.remove();
  }
}
