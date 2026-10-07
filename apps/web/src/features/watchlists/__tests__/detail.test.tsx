import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tick } from "@/features/realtime/schemas";
import { marketActions } from "@/features/realtime/store";
import { mockApi, problem } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";

import { ANNOUNCE_EVERY_MS, InstrumentDetail } from "../components/instrument-detail";
import { MarketDepth } from "../components/market-depth";
import MiniChart from "../components/mini-chart";
import { IST_OFFSET_S } from "../lib/intraday";

import { NIFTY_CE, instrument } from "./fixtures";

const chartMocks = vi.hoisted(() => {
  const priceLine = { applyOptions: vi.fn() };
  const series = {
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => priceLine),
  };
  const timeScale = { fitContent: vi.fn() };
  const chart = {
    addSeries: vi.fn(() => series),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: vi.fn(() => timeScale),
  };
  return { chart, series, priceLine, createChart: vi.fn(() => chart) };
});

vi.mock("lightweight-charts", () => ({
  createChart: chartMocks.createChart,
  BaselineSeries: "Baseline",
  ColorType: { Solid: "solid" },
  CrosshairMode: { Magnet: 1 },
  LineStyle: { Dashed: 2 },
}));
vi.mock("next/navigation", () => nextNavigationMock);

const NIFTY_INDEX = instrument("NIFTY 50", {
  key: "NSE_INDEX|NIFTY 50",
  segment: "INDEX",
  name: "Nifty 50",
  tradingSymbol: null,
});
/** 2026-10-06 09:15 IST, as epoch ms. */
const SESSION_MS = Date.UTC(2026, 9, 6, 3, 45);
const CANDLES = [
  { ts: SESSION_MS - 86_400_000, open: "1", high: "1", low: "1", close: "1", volume: 0 },
  { ts: SESSION_MS, open: "100", high: "101", low: "99", close: "100.5", volume: 10 },
  { ts: SESSION_MS + 300_000, open: "100.5", high: "102", low: "100", close: "101.5", volume: 12 },
];

function tick(overrides: Partial<Tick> = {}): Tick {
  return {
    ltp: 101.75,
    chg: 1.75,
    chgPct: 1.75,
    vol: 2_500_000,
    ts: SESSION_MS + 400_000,
    receivedAt: Date.now(),
    open: 100,
    high: 102,
    low: 99,
    close: 100,
    oi: 1_200_000,
    atp: 100.9,
    ...overrides,
  };
}

function push(key: string, next: Tick) {
  act(() => {
    marketActions.applyTicks(new Map([[key, next]]));
  });
}

beforeEach(() => {
  marketActions.reset();
  vi.clearAllMocks();
  document.documentElement.style.setProperty("--profit", "#047857");
  document.documentElement.style.setProperty("--loss", "#be123c");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InstrumentDetail", () => {
  it("shows an option's quote, statistics, depth and intraday chart", async () => {
    mockApi([
      { path: /^\/v1\/candles\?/, respond: () => Response.json(CANDLES) },
      {
        path: /^\/v1\/quotes\/depth/,
        respond: () =>
          Response.json({
            k: NIFTY_CE.key,
            t: 1,
            bids: [["101.7", 750, 3]],
            asks: [["101.8", 1500, 5]],
            tbq: null,
            tsq: null,
          }),
      },
    ]);
    push(NIFTY_CE.key, tick());
    act(() => {
      marketActions.setSource({ source: "PAPER", live: false });
    });
    const { container } = renderWithProviders(<InstrumentDetail instrument={NIFTY_CE} />);
    const detail = screen.getByRole("article", { name: "NIFTY 24000 CE" });
    expect(within(detail).getByText("Simulated")).toBeInTheDocument();
    expect(within(detail).getByText("Expiry 30 Oct 2025 · Lot 75")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Open chart" })).toHaveAttribute(
      "href",
      `/charts?key=${encodeURIComponent(NIFTY_CE.key)}`,
    );
    const stat = (label: string) => within(detail).getByText(label).nextElementSibling?.textContent;
    expect(stat("Open")).toBe("100.00");
    expect(stat("ATP")).toBe("100.90");
    expect(stat("Volume")).toBe("25 L");
    expect(stat("OI")).toBe("12 L");
    expect(stat("Lot size")).toBe("75");
    expect(within(detail).getByText(/Last trade \d\d:\d\d:\d\d IST/)).toBeInTheDocument();
    expect(within(detail).getByText(/92% of the way from the day's low to its high/)).toBeInTheDocument();

    // Depth without exchange totals: the levels shown are summed.
    const table = await within(detail).findByRole("table", { name: /Market depth for NIFTY 24000 CE/ });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(table).toHaveTextContent("1,500");
    expect(within(detail).getByText("Buy 33.3%")).toBeInTheDocument();

    // The chart: the latest session only, around the previous close.
    await waitFor(() => {
      expect(chartMocks.series.setData).toHaveBeenCalledWith([
        { time: SESSION_MS / 1_000 + IST_OFFSET_S, value: 100.5 },
        { time: SESSION_MS / 1_000 + 300 + IST_OFFSET_S, value: 101.5 },
      ]);
    });
    expect(chartMocks.chart.addSeries).toHaveBeenCalledWith(
      "Baseline",
      expect.objectContaining({ baseValue: { type: "price", price: 100 }, topLineColor: "#047857" }),
    );
    expect(screen.getByRole("img", { name: /NIFTY 24000 CE intraday chart, 5-minute closes: 2 points/ })).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it("explains that an index has no order book and asks for no depth", async () => {
    const calls = mockApi([{ path: /^\/v1\/candles\?/, respond: () => Response.json([]) }]);
    renderWithProviders(<InstrumentDetail instrument={NIFTY_INDEX} />);
    expect(screen.getByText(/Indices aren't traded, so they have no order book/)).toBeInTheDocument();
    expect(screen.queryByText("ATP")).toBeNull();
    expect(screen.getByText("Waiting for the first price")).toBeInTheDocument();
    expect(await screen.findByText(/No intraday candles yet/)).toBeInTheDocument();
    expect(calls.some((call) => call.path.startsWith("/v1/quotes/depth"))).toBe(false);
  });

  it("offers a retry when the candles fail, and remove and close actions when given", async () => {
    const actor = userEvent.setup();
    let fail = true;
    mockApi([
      { path: /^\/v1\/candles\?/, respond: () => (fail ? problem(500, "INTERNAL") : Response.json(CANDLES)) },
      { path: /^\/v1\/quotes\/depth/, respond: () => problem(404, "NOT_FOUND") },
    ]);
    const onRemove = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <InstrumentDetail instrument={NIFTY_CE} onRemove={onRemove} removeLabel="Remove it" onClose={onClose} />,
    );
    expect(await screen.findByText("The intraday chart didn't load.")).toBeInTheDocument();
    expect(await screen.findByText(/No market depth yet/)).toBeInTheDocument();
    fail = false;
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(chartMocks.createChart).toHaveBeenCalled();
    });
    await actor.click(screen.getByRole("button", { name: "Remove it" }));
    await actor.click(screen.getByRole("button", { name: "Close details" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("announces the price politely, at most every ten seconds", () => {
    vi.useFakeTimers();
    mockApi([]);
    renderWithProviders(<InstrumentDetail instrument={NIFTY_INDEX} />);
    const region = document.querySelector('[data-slot="price-announcer"]');
    expect(region).toHaveAttribute("aria-live", "polite");
    push(NIFTY_INDEX.key, tick({ ltp: 24_012.35, chg: 120.5, chgPct: 0.5 }));
    expect(region).toHaveTextContent("");
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_EVERY_MS);
    });
    expect(region).toHaveTextContent("NIFTY 50, NSE 24,012.35, up 0.50%");
    push(NIFTY_INDEX.key, tick({ ltp: 23_990, chg: -10, chgPct: -0.04 }));
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_EVERY_MS - 1);
    });
    expect(region).toHaveTextContent("24,012.35");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(region).toHaveTextContent("NIFTY 50, NSE 23,990.00, down 0.04%");
  });
});

describe("MarketDepth", () => {
  it("says why depth isn't streaming when the server refused it", async () => {
    mockApi([{ path: /^\/v1\/quotes\/depth/, respond: () => problem(404, "NOT_FOUND") }]);
    act(() => {
      marketActions.setDepthRejected(NIFTY_CE.key, "limit");
    });
    renderWithProviders(<MarketDepth instrumentKey={NIFTY_CE.key} symbol="NIFTY 24000 CE" />);
    expect(await screen.findByText(/too many market depth panels are open/)).toBeInTheDocument();
  });

  it("shows a shaped skeleton while the snapshot loads", () => {
    mockApi([{ path: /^\/v1\/quotes\/depth/, respond: () => new Promise<Response>(() => undefined) }]);
    renderWithProviders(<MarketDepth instrumentKey={NIFTY_CE.key} symbol="NIFTY 24000 CE" />);
    expect(screen.getByRole("status", { name: "Loading market depth for NIFTY 24000 CE" })).toBeInTheDocument();
  });
});

describe("MiniChart", () => {
  const POINTS = [
    { time: SESSION_MS / 1_000 + IST_OFFSET_S, value: 100 },
    { time: SESSION_MS / 1_000 + 300 + IST_OFFSET_S, value: 101 },
  ];

  it("moves the last point with live ticks, follows the theme and the baseline, and is removed on unmount", () => {
    const { rerender, unmount } = render(
      <MiniChart instrumentKey={NIFTY_CE.key} points={POINTS} baseline={99} summary="Chart" />,
    );
    expect(chartMocks.series.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: 99 }));
    expect(chartMocks.chart.timeScale().fitContent).toHaveBeenCalled();

    push(NIFTY_CE.key, tick({ ltp: 101.25, ts: SESSION_MS + 360_000 }));
    expect(chartMocks.series.update).toHaveBeenLastCalledWith({
      time: SESSION_MS / 1_000 + 300 + IST_OFFSET_S,
      value: 101.25,
    });
    push(NIFTY_CE.key, tick({ ltp: 102, ts: SESSION_MS + 600_000 }));
    expect(chartMocks.series.update).toHaveBeenLastCalledWith({
      time: SESSION_MS / 1_000 + 600 + IST_OFFSET_S,
      value: 102,
    });
    // Older, or a later day: not this session's line.
    push(NIFTY_CE.key, tick({ ltp: 50, ts: SESSION_MS }));
    push(NIFTY_CE.key, tick({ ltp: 60, ts: SESSION_MS + 86_400_000 }));
    expect(chartMocks.series.update).toHaveBeenCalledTimes(2);

    rerender(<MiniChart instrumentKey={NIFTY_CE.key} points={POINTS} baseline={100.5} summary="Chart" />);
    expect(chartMocks.priceLine.applyOptions).toHaveBeenCalledWith({ price: 100.5 });

    act(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    return waitFor(() => {
      expect(chartMocks.chart.applyOptions).toHaveBeenCalled();
    }).then(() => {
      unmount();
      expect(chartMocks.chart.remove).toHaveBeenCalledTimes(1);
      push(NIFTY_CE.key, tick({ ltp: 103, ts: SESSION_MS + 900_000 }));
      expect(chartMocks.series.update).toHaveBeenCalledTimes(2);
    });
  });
});
