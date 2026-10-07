import { act, screen, within } from "@testing-library/react";
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
import { pctChange, rangePosition } from "../components/session-insights";

import { NIFTY_CE, instrument } from "./fixtures";

vi.mock("next/navigation", () => nextNavigationMock);

const NIFTY_INDEX = instrument("NIFTY 50", {
  key: "NSE_INDEX|NIFTY 50",
  segment: "INDEX",
  name: "Nifty 50",
  tradingSymbol: null,
});
/** 2026-10-06 09:15 IST, as epoch ms. */
const SESSION_MS = Date.UTC(2026, 9, 6, 3, 45);

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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InstrumentDetail", () => {
  it("shows an option's quote, statistics, depth and live session insights (no chart)", async () => {
    const calls = mockApi([
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

    // Session insights instead of a chart: nothing fetches candles, nothing draws on a canvas.
    const insights = within(detail).getByText("Session insights").closest("section");
    expect(insights).not.toBeNull();
    expect(insights).toHaveTextContent("vs previous close");
    expect(insights).toHaveTextContent("vs today's open");
    expect(within(insights as HTMLElement).getByRole("meter", { name: "Price within today's range" })).toHaveAttribute(
      "aria-valuenow",
      "92",
    );
    expect(calls.some((call) => call.path.startsWith("/v1/candles"))).toBe(false);
    expect(container.querySelector("canvas")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("explains that an index has no order book and asks for no depth", () => {
    const calls = mockApi([]);
    renderWithProviders(<InstrumentDetail instrument={NIFTY_INDEX} />);
    expect(screen.getByText(/Indices aren't traded, so they have no order book/)).toBeInTheDocument();
    expect(screen.queryByText("ATP")).toBeNull();
    expect(screen.getByText("Waiting for the first price")).toBeInTheDocument();
    expect(screen.queryByText("Order flow")).toBeNull();
    expect(calls.some((call) => call.path.startsWith("/v1/quotes/depth"))).toBe(false);
  });

  it("says when there's no depth yet, and offers remove and close actions when given", async () => {
    const actor = userEvent.setup();
    mockApi([{ path: /^\/v1\/quotes\/depth/, respond: () => problem(404, "NOT_FOUND") }]);
    const onRemove = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <InstrumentDetail instrument={NIFTY_CE} onRemove={onRemove} removeLabel="Remove it" onClose={onClose} />,
    );
    expect(await screen.findByText(/No market depth yet/)).toBeInTheDocument();
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

describe("session insight maths", () => {
  it("computes percentage changes and the position in the day's range", () => {
    expect(pctChange(101, 100)).toBeCloseTo(1);
    expect(pctChange(99, 0)).toBeNull();
    expect(pctChange(null, 100)).toBeNull();
    expect(rangePosition(101.75, 99, 102)).toBeCloseTo(91.67, 1);
    expect(rangePosition(105, 99, 102)).toBe(100);
    expect(rangePosition(100, 102, 102)).toBeNull();
  });
});
