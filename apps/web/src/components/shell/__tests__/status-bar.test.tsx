import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketOverview, UPSTOX_FEED } from "@/features/market/__tests__/fixtures";
import { marketActions } from "@/features/realtime/store";
import { mockApi, problem } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { RISK_LINE, StatusBar } from "../status-bar";

const retry = vi.fn();
vi.mock("@/features/realtime/components/realtime-provider", () => ({
  useRealtimeClient: () => ({ retry, subscribe: () => () => undefined }),
}));

function serveOverview(overview = marketOverview()) {
  return mockApi([{ path: "/v1/market/overview", respond: () => Response.json(overview) }]);
}

beforeEach(() => {
  marketActions.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StatusBar", () => {
  it("is a labelled footer with the sessions, the feed, the socket, the risk line, the version and the clock", async () => {
    serveOverview();
    const { container } = renderWithProviders(<StatusBar version="0.0.1" />);

    const footer = screen.getByRole("contentinfo", { name: "Status bar" });
    expect(footer).toHaveClass("h-8", "bg-surface-1", "border-t", "border-border", "shrink-0");
    const sessions = within(footer).getByRole("list", { name: "Exchange sessions" });
    await waitFor(() => {
      expect(
        within(sessions)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["NSEOpen · , closes 15:30", "BSEOpen · , closes 15:30", "MCXOpen · , closes 23:30"]);
    });
    expect(within(footer).getByText(RISK_LINE)).toHaveAttribute("title", RISK_LINE);
    expect(footer).toHaveTextContent("v0.0.1");
    expect(footer.querySelector('[data-slot="ist-clock"]')).toHaveTextContent(/^\d{2}:\d{2}:\d{2} IST$/);
    await expectNoAxeViolations(container);
  });

  it("keeps only NSE, the feed and the clock below 640 px", async () => {
    serveOverview();
    renderWithProviders(<StatusBar version="0.0.1" />);

    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.className.includes("hidden sm:flex"))).toEqual([false, true, true]);
    expect(screen.getByRole("contentinfo").querySelector('[data-slot="realtime-connection"]')).toHaveClass(
      "hidden",
      "sm:flex",
    );
    expect(screen.getByText(RISK_LINE)).toHaveClass("hidden", "lg:block");
  });

  it("labels simulated prices in amber, links to Brokers and gives the reason in a tooltip", async () => {
    const actor = userEvent.setup();
    serveOverview();
    renderWithProviders(<StatusBar />);

    const simulated = await screen.findByRole("link", { name: /^Simulated\s+prices$/ });
    expect(simulated).toHaveAttribute("href", "/brokers");
    expect(simulated).toHaveClass("bg-warning/10", "text-warning");
    await actor.hover(simulated);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "No active Upstox or Dhan account. Prices are simulated; connect a broker for live data.",
    );
  });

  it("names the live broker, and says when its feed is delayed or down", async () => {
    serveOverview(marketOverview({ feed: UPSTOX_FEED }));
    renderWithProviders(<StatusBar />);

    const feed = await screen.findByText("Live");
    const source = feed.closest('[data-slot="feed-source"]');
    expect(source).toHaveTextContent("Live· from Upstox");
    expect(feed).toHaveClass("text-profit");

    act(() => {
      marketActions.setFeed("stale");
    });
    expect(source).toHaveTextContent("Delayed");
    act(() => {
      marketActions.setFeed("down");
    });
    expect(source).toHaveTextContent("Feed down");
  });

  it("stays quiet while the overview loads or when it fails", async () => {
    mockApi([{ path: "/v1/market/overview", respond: () => problem(503, "SERVICE_UNAVAILABLE") }]);
    renderWithProviders(<StatusBar />);

    const feed = screen.getByRole("contentinfo").querySelector('[data-slot="feed-source"]');
    expect(feed).toHaveAttribute("data-state", "pending");
    expect(feed).toHaveTextContent("Feed");
    await waitFor(() => {
      expect(feed).toHaveAttribute("data-state", "error");
    });
    expect(feed).toHaveTextContent("status unavailable");
    expect(screen.getAllByText("status unavailable")).toHaveLength(4);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the socket's state and retries once it has given up", () => {
    serveOverview();
    renderWithProviders(<StatusBar />);
    const connection = screen.getByRole("contentinfo").querySelector('[data-slot="realtime-connection"]');
    expect(connection).toHaveTextContent("Realtime: Standby");

    act(() => {
      marketActions.setConnection("connected");
    });
    expect(connection).toHaveTextContent("Connected");

    act(() => {
      marketActions.setConnection("unavailable");
    });
    expect(connection).toHaveTextContent("Offline");
    fireEvent.click(screen.getByRole("button", { name: /^Retry\s+the realtime connection$/ }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("ticks the IST clock every second and clears its timer on unmount", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-06T08:00:00.000Z"));
    serveOverview();
    const { unmount } = renderWithProviders(<StatusBar />);

    const clock = screen.getByRole("contentinfo").querySelector('[data-slot="ist-clock"]');
    expect(clock).toHaveTextContent("13:30:00 IST");
    expect(clock).toHaveAttribute("datetime", "2026-10-06T08:00:00.000Z");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(clock).toHaveTextContent("13:30:01 IST");

    const intervals = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBeLessThan(intervals);
  });
});
