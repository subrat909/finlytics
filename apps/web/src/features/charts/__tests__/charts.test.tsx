import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketActions } from "@/features/realtime/store";
import { mockApi, problem } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock, router } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";

import { ChartsView } from "../components/charts-view";
import LightweightChart from "../components/lightweight-chart";
import TradingViewChart from "../components/tradingview-chart";
import { IST_OFFSET_S } from "../lib/bars";

const chartMocks = vi.hoisted(() => {
  const series = () => ({
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
  });
  const candles = series();
  const volume = series();
  const chart = {
    addSeries: vi.fn((definition: string) => (definition === "Candlestick" ? candles : volume)),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: vi.fn(() => ({ scrollToRealTime: vi.fn() })),
  };
  return { chart, candles, volume, createChart: vi.fn(() => chart) };
});

vi.mock("lightweight-charts", () => ({
  createChart: chartMocks.createChart,
  CandlestickSeries: "Candlestick",
  HistogramSeries: "Histogram",
  ColorType: { Solid: "solid" },
  CrosshairMode: { Normal: 0 },
}));
vi.mock("next/navigation", () => nextNavigationMock);

const KEY = "NSE_INDEX|NIFTY 50";
const NIFTY = {
  key: KEY,
  exchange: "NSE",
  segment: "INDEX",
  symbol: "NIFTY 50",
  tradingSymbol: null,
  name: "Nifty 50",
  expiry: null,
  strike: null,
  optionType: null,
  lotSize: 1,
  tickSize: "0.05",
  isActive: true,
};
const BAR_MS = 1_759_895_100_000;
const CANDLES = [
  { ts: BAR_MS - 300_000, open: "24000", high: "24010", low: "23990", close: "24005", volume: 0 },
  { ts: BAR_MS, open: "24005", high: "24020", low: "24000", close: "24015.5", volume: 0 },
];

beforeEach(() => {
  marketActions.reset();
  vi.clearAllMocks();
  document.documentElement.style.setProperty("--profit", "#047857");
  document.documentElement.style.setProperty("--loss", "#be123c");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function routes(candles: () => Response = () => Response.json(CANDLES)) {
  return mockApi([
    { path: `/v1/instruments/${encodeURIComponent(KEY)}`, respond: () => Response.json(NIFTY) },
    { path: /^\/v1\/candles\?/, respond: candles },
    {
      path: /^\/v1\/quotes\?/,
      respond: () => Response.json({ [KEY]: { ltp: "24015.5", chg: "15", chgPct: "0.06", ts: 1 } }),
    },
  ]);
}

describe("ChartsView", () => {
  it("asks for an instrument when there is none, and opens the chart of the one picked", async () => {
    const actor = userEvent.setup();
    mockApi([{ path: /^\/v1\/instruments\?q=nif/, respond: () => Response.json([NIFTY]) }]);
    const { container } = renderWithProviders(<ChartsView timeframe="M5" />);
    expect(screen.getByRole("heading", { level: 2, name: "Choose an instrument" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await actor.type(screen.getByRole("combobox", { name: "Open a chart" }), "nif");
    await actor.click(await screen.findByRole("option", { name: /NIFTY 50/ }));
    expect(router.push).toHaveBeenCalledWith(`/charts?key=${encodeURIComponent(KEY)}&tf=M5`);
  });

  it("explains an invalid instrument link", () => {
    renderWithProviders(<ChartsView invalidKey timeframe="M5" />);
    expect(screen.getByRole("heading", { name: "That instrument link isn't valid" })).toBeInTheDocument();
  });

  it("draws the candles, follows live ticks on the last bar and switches timeframe", async () => {
    const actor = userEvent.setup();
    const replaceState = vi.spyOn(window.history, "replaceState");
    const calls = routes();
    const { container, unmount } = renderWithProviders(<ChartsView instrumentKey={KEY} timeframe="M5" />);
    expect(await screen.findByRole("heading", { level: 1, name: "NIFTY 50 chart" })).toBeInTheDocument();
    expect(await screen.findByText("Nifty 50 · NSE")).toBeInTheDocument();

    const chart = await screen.findByRole("img", { name: /NIFTY 50 candlestick chart, 5 minutes candles, 2 candles/ });
    expect(chart).toBeInTheDocument();
    expect(chartMocks.createChart).toHaveBeenCalledTimes(1);
    const firstCall = chartMocks.candles.setData.mock.calls[0] as unknown[] | undefined;
    expect(firstCall?.[0]).toEqual([
      { time: (BAR_MS - 300_000) / 1_000 + IST_OFFSET_S, open: 24000, high: 24010, low: 23990, close: 24005 },
      { time: BAR_MS / 1_000 + IST_OFFSET_S, open: 24005, high: 24020, low: 24000, close: 24015.5 },
    ]);
    const candlesCall = calls.find((call) => call.path.startsWith("/v1/candles"));
    expect(candlesCall?.path).toMatch(/key=NSE_INDEX%7CNIFTY\+50&tf=M5&from=\d+&to=\d+/);
    await expectNoAxeViolations(container);

    // A tick inside the last bar updates it; the next one opens a new bar.
    act(() => {
      marketActions.applyTicks(
        new Map([[KEY, { ltp: 24030, chg: 30, chgPct: 0.12, vol: 100, ts: BAR_MS + 60_000, receivedAt: 1 }]]),
      );
    });
    expect(chartMocks.candles.update).toHaveBeenLastCalledWith({
      time: BAR_MS / 1_000 + IST_OFFSET_S,
      open: 24005,
      high: 24030,
      low: 24000,
      close: 24030,
    });
    act(() => {
      marketActions.applyTicks(
        new Map([[KEY, { ltp: 24001, chg: 1, chgPct: 0, vol: 160, ts: BAR_MS + 300_000, receivedAt: 2 }]]),
      );
    });
    expect(chartMocks.candles.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ time: BAR_MS / 1_000 + 300 + IST_OFFSET_S, open: 24001 }),
    );
    expect(chartMocks.volume.update).toHaveBeenLastCalledWith(expect.objectContaining({ value: 60 }));

    // The theme switch re-reads the tokens.
    document.documentElement.setAttribute("data-theme", "dark");
    await waitFor(() => {
      expect(chartMocks.chart.applyOptions).toHaveBeenCalled();
    });

    // Timeframe: a radio group with arrow keys; the URL follows without a navigation.
    const group = screen.getByRole("radiogroup", { name: "Timeframe" });
    expect(within(group).getByRole("radio", { name: "5 minutes" })).toHaveAttribute("aria-checked", "true");
    within(group).getByRole("radio", { name: "5 minutes" }).focus();
    await actor.keyboard("{ArrowRight}");
    expect(within(group).getByRole("radio", { name: "15 minutes" })).toHaveFocus();
    expect(replaceState).toHaveBeenLastCalledWith(null, "", `/charts?key=${encodeURIComponent(KEY)}&tf=M15`);
    await actor.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(within(group).getByRole("radio", { name: "1 minute" })).toHaveAttribute("aria-checked", "true");
    await actor.click(within(group).getByRole("radio", { name: "1 day" }));
    await waitFor(() => {
      expect(calls.some((call) => call.path.includes("tf=D1"))).toBe(true);
    });

    unmount();
    expect(chartMocks.chart.remove).toHaveBeenCalled();
  });

  it("shows a retryable error when the candles fail, and the empty history note", async () => {
    const actor = userEvent.setup();
    let fail = true;
    routes(() => (fail ? problem(503, "SERVICE_UNAVAILABLE") : Response.json([])));
    renderWithProviders(<ChartsView instrumentKey={KEY} timeframe="H1" />);
    expect(await screen.findByRole("alert", {}, { timeout: 5_000 })).toHaveTextContent("The candles didn't load");
    fail = false;
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No price history for this timeframe yet/)).toBeInTheDocument();
  });
});

describe("LightweightChart", () => {
  it("draws the first live bar when there is no history", () => {
    render(<LightweightChart bars={[]} instrumentKey={KEY} period={60} summary="Chart" />);
    act(() => {
      marketActions.applyTicks(new Map([[KEY, { ltp: 10, chg: 0, chgPct: 0, vol: null, ts: 120_000, receivedAt: 1 }]]));
    });
    expect(chartMocks.candles.update).toHaveBeenCalledWith({
      time: 120 + IST_OFFSET_S,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
    });
  });
});

interface WidgetOptions {
  symbol: string;
  interval: string;
  theme: string;
  datafeed: unknown;
}

describe("TradingViewChart", () => {
  function stubScripts(outcome: "load" | "error") {
    const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      for (const node of nodes) {
        if (!(node instanceof HTMLScriptElement)) continue;
        queueMicrotask(() => {
          if (outcome === "load") node.onload?.(new Event("load"));
          else node.onerror?.(new Event("error"));
        });
      }
    });
    return append;
  }

  it("loads the library and the UDF datafeed, then removes the widget on unmount", async () => {
    stubScripts("load");
    const remove = vi.fn();
    const changeTheme = vi.fn();
    const widget = vi.fn<(this: { remove: () => void; changeTheme: () => void }, options: WidgetOptions) => void>(
      function (this: { remove: () => void; changeTheme: () => void }) {
        this.remove = remove;
        this.changeTheme = changeTheme;
      },
    );
    const datafeed = vi.fn();
    vi.stubGlobal("TradingView", { widget });
    vi.stubGlobal("Datafeeds", { UDFCompatibleDatafeed: datafeed });

    const { unmount } = render(
      <TradingViewChart
        instrumentKey={KEY}
        timeframe="H1"
        datafeedPath="/datafeeds/udf/dist/bundle.js"
        summary="NIFTY chart"
      />,
    );
    await waitFor(() => {
      expect(widget).toHaveBeenCalledTimes(1);
    });
    expect(datafeed).toHaveBeenCalledWith("/v1/udf", 5_000);
    expect(widget.mock.calls[0]?.[0]).toMatchObject({
      symbol: KEY,
      interval: "60",
      library_path: "/charting_library/",
    });
    document.documentElement.setAttribute("data-theme", "light");
    await waitFor(() => {
      expect(changeTheme).toHaveBeenCalledWith("light");
    });
    unmount();
    expect(remove).toHaveBeenCalled();
  });

  it("shows a retryable error when the library doesn't load", async () => {
    const actor = userEvent.setup();
    stubScripts("error");
    render(
      <TradingViewChart
        instrumentKey={KEY}
        timeframe="M1"
        datafeedPath="/datafeeds/udf/dist/missing.js"
        summary="Chart"
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The chart library didn't load");
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
