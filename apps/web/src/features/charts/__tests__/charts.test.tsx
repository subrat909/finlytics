import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tick } from "@/features/realtime/schemas";
import { marketActions } from "@/features/realtime/store";
import { mockApi, problem } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock, router } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";

import { ChartsView } from "../components/charts-view";
import type { DrawingsPrimitive } from "../lib/chart/drawings-primitive";
import { IST_OFFSET_S } from "../lib/time";

interface MockSeries {
  definition: string;
  options: Record<string, unknown>;
  paneIndex: number;
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  attachPrimitive: ReturnType<typeof vi.fn>;
}

const lwc = vi.hoisted(() => {
  const state = {
    series: [] as MockSeries[],
    removed: [] as unknown[],
    paneCount: 1,
  };
  const pane = (index: number) => ({
    setPreserveEmptyPane: vi.fn(),
    setStretchFactor: vi.fn(),
    getHTMLElement: () => document.createElement("tr"),
    getSeries: () => state.series.filter((series) => series.paneIndex === index && !state.removed.includes(series)),
  });
  const timeScale = {
    scrollToRealTime: vi.fn(),
    fitContent: vi.fn(),
    setVisibleRange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    logicalToCoordinate: vi.fn(() => 10),
    coordinateToLogical: vi.fn(() => 0),
    getVisibleLogicalRange: vi.fn(() => null),
    applyOptions: vi.fn(),
  };
  const priceScale = { applyOptions: vi.fn(), options: () => ({ autoScale: true }) };
  const chart = {
    addSeries: vi.fn((definition: string, options?: Record<string, unknown>, index?: number) => {
      const paneIndex: number = index ?? 0;
      const series: MockSeries & Record<string, unknown> = {
        definition,
        options: options ?? {},
        paneIndex,
        setData: vi.fn(),
        update: vi.fn(),
        applyOptions: vi.fn(),
        attachPrimitive: vi.fn(),
        detachPrimitive: vi.fn(),
        setSeriesOrder: vi.fn(),
        priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
        priceToCoordinate: vi.fn(() => 100),
        coordinateToPrice: vi.fn(() => 24_000),
        createPriceLine: vi.fn(() => ({})),
        removePriceLine: vi.fn(),
      };
      state.series.push(series);
      state.paneCount = Math.max(state.paneCount, paneIndex + 1);
      return series;
    }),
    removeSeries: vi.fn((series: unknown) => {
      state.removed.push(series);
    }),
    panes: vi.fn(() => Array.from({ length: state.paneCount }, (_, index) => pane(index))),
    removePane: vi.fn(() => {
      state.paneCount = Math.max(1, state.paneCount - 1);
    }),
    applyOptions: vi.fn(),
    priceScale: vi.fn(() => priceScale),
    timeScale: vi.fn(() => timeScale),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    paneSize: vi.fn(() => ({ width: 800, height: 400 })),
    takeScreenshot: vi.fn(),
    remove: vi.fn(),
  };
  return { state, chart, timeScale, createChart: vi.fn(() => chart) };
});

vi.mock("lightweight-charts", () => ({
  createChart: lwc.createChart,
  CandlestickSeries: "Candlestick",
  BarSeries: "Bar",
  LineSeries: "Line",
  AreaSeries: "Area",
  BaselineSeries: "Baseline",
  HistogramSeries: "Histogram",
  ColorType: { Solid: "solid" },
  CrosshairMode: { Normal: 0, Magnet: 1, Hidden: 2 },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
}));
vi.mock("next/navigation", () => nextNavigationMock);

const KEY = "NSE_INDEX|NIFTY 50";
const instrument = (key: string, symbol: string, segment: "INDEX" | "EQ", name: string) => ({
  key,
  exchange: "NSE",
  segment,
  symbol,
  tradingSymbol: null,
  name,
  expiry: null,
  strike: null,
  optionType: null,
  lotSize: 1,
  tickSize: "0.05",
  isActive: true,
});
const NIFTY = instrument(KEY, "NIFTY 50", "INDEX", "Nifty 50");
const RELIANCE = instrument("NSE_EQ|RELIANCE", "RELIANCE", "EQ", "Reliance Industries");
/** Wednesday 2025-10-08 09:15 IST. */
const BAR_MS = 1_759_895_100_000;
const CANDLES = [
  { ts: BAR_MS - 300_000, open: "24000", high: "24010", low: "23990", close: "24005", volume: 0 },
  { ts: BAR_MS, open: "24005", high: "24020", low: "24000", close: "24015.5", volume: 0 },
];
const OVERVIEW = {
  asOf: "2025-10-08T04:00:00.000Z",
  exchanges: [],
  feed: { state: "up", source: "PAPER", live: false, lastTickAt: null, reason: null },
  indices: [],
  gainers: [],
  losers: [],
  active: [],
  breadth: { advances: 0, declines: 0, unchanged: 0 },
};
const WATCHLISTS = [
  {
    id: "w1",
    name: "Main",
    position: 0,
    items: [
      { id: "i1", instrumentKey: KEY, position: 0, instrument: NIFTY },
      { id: "i2", instrumentKey: RELIANCE.key, position: 1, instrument: RELIANCE },
    ],
  },
];

const chartTime = (ms: number) => ms / 1_000 + IST_OFFSET_S;

function tick(ltp: number, ts: number, vol: number | null): Tick {
  return { ltp, chg: ltp - 24_000, chgPct: 0.1, vol, ts, receivedAt: Date.now() };
}

/** The api: candles only in the window that holds BAR_MS (older windows are empty, so history ends). */
function routes(candles: () => Response = () => Response.json(CANDLES)) {
  return mockApi([
    { path: `/v1/instruments/${encodeURIComponent(KEY)}`, respond: () => Response.json(NIFTY) },
    { path: /^\/v1\/instruments\?q=/, respond: () => Response.json([NIFTY, RELIANCE]) },
    {
      path: /^\/v1\/candles\?/,
      respond: (call) => {
        const query = new URLSearchParams(call.path.split("?")[1]);
        const to = Number(query.get("to")) * 1_000;
        const from = Number(query.get("from")) * 1_000;
        return from <= BAR_MS && BAR_MS < to ? candles() : Response.json([]);
      },
    },
    { path: /^\/v1\/quotes\?/, respond: () => Response.json({}) },
    { path: "/v1/market/overview", respond: () => Response.json(OVERVIEW) },
    { path: "/v1/watchlists", respond: () => Response.json(WATCHLISTS) },
  ]);
}

function seriesOf(definition: string): MockSeries[] {
  return lwc.state.series.filter((series) => series.definition === definition && !lwc.state.removed.includes(series));
}

function mainSeries(): MockSeries {
  const main = lwc.state.series.find(
    (series) => series.attachPrimitive.mock.calls.length > 0 && !lwc.state.removed.includes(series),
  );
  if (main === undefined) throw new Error("no main series");
  return main;
}

// The watchlist virtualiser measures its scroll box; jsdom has no layout.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
  marketActions.reset();
  vi.clearAllMocks();
  lwc.state.series = [];
  lwc.state.removed = [];
  lwc.state.paneCount = 1;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BAR_MS + 600_000);
  document.documentElement.style.setProperty("--profit", "#047857");
  document.documentElement.style.setProperty("--loss", "#be123c");
});

afterEach(() => {
  if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ChartsView without an instrument", () => {
  it("offers the search and popular indices, and opens the chart of the one picked", async () => {
    const actor = userEvent.setup();
    routes();
    const { container } = renderWithProviders(<ChartsView />);
    expect(screen.getByRole("heading", { level: 2, name: "Choose an instrument" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Popular indices" })).getByRole("link", { name: /SENSEX/ }),
    ).toHaveAttribute("href", `/charts?key=${encodeURIComponent("BSE_INDEX|SENSEX")}&tf=M5`);
    await expectNoAxeViolations(container);
    await actor.type(screen.getByRole("combobox", { name: "Open a chart" }), "nif");
    await actor.click(await screen.findByRole("option", { name: /NIFTY 50/ }));
    expect(router.push).toHaveBeenCalledWith(`/charts?key=${encodeURIComponent(KEY)}&tf=M5`);
  });

  it("explains an invalid instrument link", () => {
    renderWithProviders(<ChartsView invalidKey />);
    expect(screen.getByRole("heading", { name: "That instrument link isn't valid" })).toBeInTheDocument();
  });
});

describe("the chart workspace", () => {
  // The workspace is a `next/dynamic` import with a large module graph: load it once up front, so the first test
  // doesn't spend its time budget importing (slow when the whole suite runs in parallel).
  beforeAll(async () => {
    await import("../components/chart-workspace");
  }, 30_000);

  it("draws the candles with volume, follows live ticks, switches interval and chart type, and cleans up", async () => {
    const actor = userEvent.setup();
    const replaceState = vi.spyOn(window.history, "replaceState");
    const calls = routes();
    const { container, unmount } = renderWithProviders(
      <ChartsView instrumentKey={KEY} interval="M5" userId="user-1" />,
    );

    expect(
      await screen.findByRole("img", { name: /NIFTY 50 chart, 5 minutes bars, 2 bars, last close 24,015.50/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "NIFTY 50 chart" })).toBeInTheDocument();
    expect(lwc.createChart).toHaveBeenCalledTimes(1);
    expect(mainSeries().definition).toBe("Candlestick");
    expect(mainSeries().setData).toHaveBeenLastCalledWith([
      { time: chartTime(BAR_MS - 300_000), open: 24_000, high: 24_010, low: 23_990, close: 24_005 },
      { time: chartTime(BAR_MS), open: 24_005, high: 24_020, low: 24_000, close: 24_015.5 },
    ]);
    expect(lwc.chart.addSeries).toHaveBeenCalledWith(
      "Histogram",
      expect.objectContaining({ priceScaleId: "volume" }),
      0,
    );
    expect(calls.find((call) => call.path.startsWith("/v1/candles"))?.path).toMatch(
      /key=NSE_INDEX%7CNIFTY\+50&tf=M5&from=\d+&to=\d+/,
    );
    expect(replaceState).toHaveBeenLastCalledWith(null, "", `/charts?key=${encodeURIComponent(KEY)}&tf=M5`);

    // The legend: OHLC of the latest bar, the change from the previous close, the simulated-feed label.
    const ohlc = container.querySelector('[data-slot="legend-ohlc"]');
    if (!(ohlc instanceof HTMLElement)) throw new Error("no legend");
    await waitFor(() => {
      expect(within(ohlc).getByText("24,015.50")).toBeInTheDocument();
    });
    expect(within(ohlc).getByText(/\+10\.50 \(\+0\.04%\)/)).toBeInTheDocument();
    expect(await screen.findAllByText("Simulated")).not.toHaveLength(0);
    expect(await screen.findByRole("link", { name: /RELIANCE/ })).toHaveAttribute(
      "href",
      `/charts?key=${encodeURIComponent(RELIANCE.key)}&tf=M5`,
    );
    await expectNoAxeViolations(container);

    // A tick inside the last bar updates it; the next one opens a new bar, and volume follows its delta.
    act(() => {
      marketActions.applyTicks(new Map([[KEY, tick(24_030, BAR_MS + 60_000, 100)]]));
    });
    expect(mainSeries().update).toHaveBeenLastCalledWith({
      time: chartTime(BAR_MS),
      open: 24_005,
      high: 24_030,
      low: 24_000,
      close: 24_030,
    });
    act(() => {
      marketActions.applyTicks(new Map([[KEY, tick(24_001, BAR_MS + 300_000, 160)]]));
    });
    expect(mainSeries().update).toHaveBeenLastCalledWith(
      expect.objectContaining({ time: chartTime(BAR_MS + 300_000), open: 24_001 }),
    );
    const [volume] = seriesOf("Histogram");
    await waitFor(() => {
      expect(volume?.update).toHaveBeenLastCalledWith(expect.objectContaining({ value: 60 }), false);
    });

    // Intervals: a radio group with arrow keys; the URL follows without a navigation; 30m comes from 15m bars.
    const group = screen.getByRole("radiogroup", { name: "Interval" });
    within(group).getByRole("radio", { name: "5 minutes" }).focus();
    await actor.keyboard("{ArrowRight}");
    expect(within(group).getByRole("radio", { name: "15 minutes" })).toHaveAttribute("aria-checked", "true");
    expect(replaceState).toHaveBeenLastCalledWith(null, "", `/charts?key=${encodeURIComponent(KEY)}&tf=M15`);
    await actor.click(within(group).getByRole("radio", { name: "30 minutes" }));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", `/charts?key=${encodeURIComponent(KEY)}&tf=M30`);
    await waitFor(() => {
      expect(calls.some((call) => call.path.includes("tf=M15"))).toBe(true);
    });

    // Chart type: a menu of radio items; the main series is rebuilt, the layout saved for the user.
    await actor.click(screen.getByRole("button", { name: "Chart type: Candles" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: "Line" }));
    expect(mainSeries().definition).toBe("Line");
    expect(JSON.parse(localStorage.getItem("finlytics.chart.layout:user-1") ?? "{}")).toMatchObject({
      chartType: "line",
      interval: "M30",
    });

    // The theme switch re-reads the tokens.
    lwc.chart.applyOptions.mockClear();
    document.documentElement.setAttribute("data-theme", "dark");
    await waitFor(() => {
      expect(lwc.chart.applyOptions).toHaveBeenCalled();
    });

    unmount();
    expect(lwc.chart.remove).toHaveBeenCalled();
  });

  it("adds an indicator in its own pane, with a legend row to hide, edit and remove it", async () => {
    const actor = userEvent.setup();
    routes();
    renderWithProviders(<ChartsView instrumentKey={KEY} interval="M5" />);
    await screen.findByRole("img", { name: /2 bars/ });

    await actor.click(screen.getByRole("button", { name: /^Indicators/ }));
    const dialog = await screen.findByRole("dialog", { name: "Indicators" });
    await actor.type(within(dialog).getByRole("searchbox", { name: "Search indicators" }), "rsi");
    await actor.click(within(dialog).getByRole("button", { name: /Relative Strength Index/ }));
    expect(within(dialog).getByText("Added Relative Strength Index.")).toBeInTheDocument();
    expect(lwc.chart.addSeries).toHaveBeenCalledWith("Line", expect.objectContaining({ lineWidth: 1 }), 1);
    await actor.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const row = await screen.findByText("RSI 14 close");
    const legend = row.closest("li");
    if (legend === null) throw new Error("no legend row");
    await actor.click(within(legend).getByRole("button", { name: "Hide RSI 14 close" }));
    expect(within(legend).getByRole("button", { name: "Show RSI 14 close" })).toBeInTheDocument();

    await actor.click(within(legend).getByRole("button", { name: "RSI 14 close settings" }));
    const settings = await screen.findByRole("dialog", { name: "Relative Strength Index" });
    const length = within(settings).getByRole("spinbutton", { name: "Length" });
    await actor.clear(length);
    await actor.type(length, "21");
    await actor.click(within(settings).getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("RSI 21 close")).toBeInTheDocument();

    const rsi = seriesOf("Line").at(-1);
    await actor.click(screen.getByRole("button", { name: "Remove RSI 21 close" }));
    expect(lwc.chart.removeSeries).toHaveBeenCalledWith(rsi);
    expect(screen.queryByText("RSI 21 close")).not.toBeInTheDocument();
  });

  it("selects drawing tools by click and shortcut, and keeps drawings per instrument with undo", async () => {
    const actor = userEvent.setup();
    localStorage.setItem(
      `finlytics.chart.drawings:${KEY}`,
      JSON.stringify({
        v: 1,
        drawings: [{ id: "d1", kind: "hline", color: "info", points: [{ time: chartTime(BAR_MS), price: 24_010 }] }],
      }),
    );
    routes();
    const { container } = renderWithProviders(<ChartsView instrumentKey={KEY} interval="M5" />);
    await screen.findByRole("img", { name: /2 bars/ });
    const primitive = mainSeries().attachPrimitive.mock.calls[0]?.[0] as DrawingsPrimitive;
    expect(primitive.state.drawings.map((drawing) => drawing.kind)).toEqual(["hline"]);

    const toolbar = screen.getByRole("toolbar", { name: "Drawing tools" });
    expect(within(toolbar).getByRole("button", { name: "Cross" })).toHaveAttribute("aria-pressed", "true");
    // Grouped tools: the corner arrow opens the group's flyout; the pick becomes the group's button.
    await actor.click(within(toolbar).getByRole("button", { name: "More trend line tools" }));
    await actor.click(await screen.findByRole("menuitem", { name: /Horizontal line/ }));
    expect(within(toolbar).getByRole("button", { name: "Horizontal line" })).toHaveAttribute("aria-pressed", "true");
    await actor.keyboard("{Alt>}t{/Alt}");
    expect(within(toolbar).getByRole("button", { name: "Trend line" })).toHaveAttribute("aria-pressed", "true");
    await actor.keyboard("{Escape}{Escape}");
    expect(within(toolbar).getByRole("button", { name: "Cross" })).toHaveAttribute("aria-pressed", "true");
    // Arrow keys move through the toolbar (one tab stop).
    within(toolbar).getByRole("button", { name: "Cross" }).focus();
    await actor.keyboard("{ArrowDown}");
    expect(within(toolbar).getByRole("button", { name: "More cursors" })).toHaveFocus();

    await actor.click(within(toolbar).getByRole("button", { name: "Remove objects" }));
    await actor.click(await screen.findByRole("menuitem", { name: "Remove 1 drawing" }));
    expect(localStorage.getItem(`finlytics.chart.drawings:${KEY}`)).toBeNull();
    expect(primitive.state.drawings).toEqual([]);
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    await actor.keyboard("{Control>}z{/Control}");
    expect(primitive.state.drawings.map((drawing) => drawing.id)).toEqual(["d1"]);
    expect(localStorage.getItem(`finlytics.chart.drawings:${KEY}`)).toContain('"d1"');
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
    await expectNoAxeViolations(container);
  });

  it("zooms to a range in its interval, and toggles the price scale", async () => {
    const actor = userEvent.setup();
    routes();
    renderWithProviders(<ChartsView instrumentKey={KEY} interval="M5" />);
    await screen.findByRole("img", { name: /2 bars/ });
    // The mock history is shorter than five days, so the range shows all of it.
    await actor.click(screen.getByRole("button", { name: "5D, 5 days" }));
    await waitFor(() => {
      expect(lwc.timeScale.fitContent).toHaveBeenCalled();
    });
    await actor.click(screen.getByRole("button", { name: "1D, 1 day" }));
    expect(
      within(screen.getByRole("radiogroup", { name: "Interval" })).getByRole("radio", { name: "1 minute" }),
    ).toHaveAttribute("aria-checked", "true");
    await actor.click(screen.getByRole("button", { name: "Log scale" }));
    expect(screen.getByRole("button", { name: "Log scale" })).toHaveAttribute("aria-pressed", "true");
    expect(lwc.chart.priceScale().applyOptions).toHaveBeenLastCalledWith({ mode: 1, autoScale: true });
  });

  it("opens the symbol search by typing on the chart and switches instrument", async () => {
    const actor = userEvent.setup();
    routes();
    renderWithProviders(<ChartsView instrumentKey={KEY} interval="M5" />);
    await screen.findByRole("img", { name: /2 bars/ });
    await actor.keyboard("r");
    const dialog = await screen.findByRole("dialog", { name: "Symbol search" });
    const field = within(dialog).getByRole("combobox", { name: "Search symbols" });
    expect(field).toHaveValue("r");
    expect(field).toHaveFocus();
    await actor.keyboard("e");
    await actor.click(await within(dialog).findByRole("option", { name: /RELIANCE/ }));
    expect(router.push).toHaveBeenCalledWith(`/charts?key=${encodeURIComponent(RELIANCE.key)}&tf=M5`);
  });

  it("shows a retryable error when the candles fail, then the empty-history note", async () => {
    const actor = userEvent.setup();
    let fail = true;
    routes(() => (fail ? problem(503, "SERVICE_UNAVAILABLE") : Response.json([])));
    renderWithProviders(<ChartsView instrumentKey={KEY} interval="H1" />);
    expect(await screen.findByRole("alert", {}, { timeout: 5_000 })).toHaveTextContent("The candles didn't load");
    fail = false;
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No price history for this interval yet/)).toBeInTheDocument();
  });
});
