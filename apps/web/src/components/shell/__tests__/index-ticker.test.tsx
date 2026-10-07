import { MARKET_INDEX_KEYS } from "@finlytics/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketOverview, UPSTOX_FEED } from "@/features/market/__tests__/fixtures";
import { parseQuoteBatch } from "@/features/realtime/schemas";
import { marketActions } from "@/features/realtime/store";
import { mockApi } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { IndexTicker, TICKER_QUERY } from "../index-ticker";

const release = vi.fn();
const subscribe = vi.fn<(keys: readonly string[]) => () => void>(() => release);
vi.mock("@/features/realtime/components/realtime-provider", () => ({
  useRealtimeClient: () => ({ subscribe, retry: vi.fn() }),
}));

/** jsdom's matchMedia (test setup) never matches; this one says whether the ticker's query does. */
function viewport(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) =>
    Object.assign(new EventTarget(), {
      matches: wide && query === TICKER_QUERY,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  );
}

function items(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Market indices" })).getAllByRole("listitem");
}

beforeEach(() => {
  marketActions.reset();
  subscribe.mockClear();
  release.mockClear();
});

afterEach(() => {
  marketActions.reset();
});

describe("IndexTicker", () => {
  it("shows NIFTY 50, NIFTY BANK, SENSEX and INDIA VIX with the overview's numbers, labelled simulated", async () => {
    viewport(true);
    mockApi([{ path: "/v1/market/overview", respond: () => Response.json(marketOverview()) }]);
    const { container } = renderWithProviders(<IndexTicker className="hidden xl:flex" />);

    await waitFor(() => {
      expect(items()[0]).toHaveTextContent("Simulated");
    });
    const [, nifty, bank, sensex, vix] = items();
    expect(nifty).toHaveTextContent("NIFTY 50 24,812.35, up +128.40 (+0.52%)");
    expect(bank).toHaveTextContent("NIFTY BANK 54,310.10, down -212.75 (-0.39%)");
    expect(sensex).toHaveAttribute("data-key", MARKET_INDEX_KEYS.SENSEX);
    expect(vix).toHaveTextContent("INDIA VIX 12.84, unchanged 0.00 (0.00%)");
    expect(within(nifty as HTMLElement).getByText("+0.52%")).toHaveClass("text-profit");
    expect(screen.getByRole("list", { name: "Market indices" })).toHaveClass("hidden", "xl:flex");
    await expectNoAxeViolations(container);
  });

  it("drops the simulated label for a live feed and moves with ticks", async () => {
    viewport(true);
    mockApi([{ path: "/v1/market/overview", respond: () => Response.json(marketOverview({ feed: UPSTOX_FEED })) }]);
    renderWithProviders(<IndexTicker />);
    await waitFor(() => {
      expect(items()[0]).toHaveTextContent("NIFTY 50 24,812.35");
    });
    expect(screen.queryByText("Simulated")).not.toBeInTheDocument();

    // A `q` row on the wire (the shared 12-tuple), parsed the way the realtime client does.
    const now = Date.now();
    const rows = parseQuoteBatch(
      {
        t: now,
        d: [[MARKET_INDEX_KEYS.NIFTY, "24700.10", "-84.15", "-0.34", 0, now, null, null, null, null, null, null]],
      },
      now,
    );
    act(() => {
      marketActions.applyTicks(new Map(rows));
    });

    const nifty = items()[0] as HTMLElement;
    expect(nifty).toHaveTextContent("NIFTY 50 24,700.10, down -84.15 (-0.34%)");
    expect(within(nifty).getByText("-0.34%")).toHaveClass("text-loss");
    expect(within(nifty).getByText("▼")).toBeInTheDocument();
  });

  it("subscribes to the four indices only while it's on screen, and releases them on unmount", async () => {
    viewport(true);
    mockApi([{ path: "/v1/market/overview", respond: () => Response.json(marketOverview()) }]);
    const { unmount } = renderWithProviders(<IndexTicker />);

    await waitFor(() => {
      expect(subscribe).toHaveBeenCalledWith([
        MARKET_INDEX_KEYS.NIFTY,
        MARKET_INDEX_KEYS.BANKNIFTY,
        MARKET_INDEX_KEYS.SENSEX,
        MARKET_INDEX_KEYS.INDIAVIX,
      ]);
    });
    unmount();
    expect(release).toHaveBeenCalledOnce();
  });

  it("subscribes to nothing below 1280 px, and shows dashes without a price", () => {
    viewport(false);
    mockApi([]);
    renderWithProviders(<IndexTicker />);

    expect(subscribe).not.toHaveBeenCalled();
    expect(items()).toHaveLength(4);
    expect(items()[0]).toHaveTextContent("NIFTY 50: no price yet");
  });
});
