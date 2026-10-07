import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";

import { FeedStatus } from "../components/feed-status";
import { ChangeCell, PriceCell } from "../components/price-cell";
import { RealtimeProvider } from "../components/realtime-provider";
import { useSubscribe } from "../hooks/use-realtime";
import type { Tick } from "../schemas";
import { marketActions } from "../store";

import { FakeSocket, settle } from "./fake-socket";

const KEY = "NSE_INDEX|NIFTY 50";

function tick(overrides: Partial<Tick> = {}): Tick {
  return { ltp: 24012.35, chg: 120.5, chgPct: 0.5, vol: 10, ts: 1, receivedAt: 1_000, ...overrides };
}

function push(next: Tick) {
  act(() => {
    marketActions.applyTicks(new Map([[KEY, next]]));
  });
}

beforeEach(() => {
  marketActions.reset();
  marketActions.tickClock(1_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PriceCell", () => {
  it("shows a placeholder until the first tick, then the price with its direction", async () => {
    const { container } = render(
      <p>
        <PriceCell instrumentKey={KEY} /> <ChangeCell instrumentKey={KEY} kind="abs" />{" "}
        <ChangeCell instrumentKey={KEY} kind="pct" />
      </p>,
    );
    expect(screen.getByText("No price yet")).toBeInTheDocument();

    push(tick());
    const cell = container.querySelector('[data-slot="price-cell"]');
    expect(cell).toHaveAttribute("data-direction", "up");
    expect(cell).toHaveTextContent("▲24,012.35, up today");
    expect(screen.getByText("+120.50").closest('[data-slot="change-cell"]')).toHaveClass("tabular", "text-profit");
    expect(screen.getByText("+0.50%")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    push(tick({ ltp: 23900, chg: -10, chgPct: -0.04 }));
    expect(cell).toHaveAttribute("data-direction", "down");
    expect(cell).toHaveTextContent("▼23,900.00, down today");
  });

  it("flashes on a move for 300 ms", () => {
    vi.useFakeTimers();
    const { container } = render(<PriceCell instrumentKey={KEY} />);
    push(tick());
    const cell = container.querySelector<HTMLElement>('[data-slot="price-cell"]');
    expect(cell?.dataset.flash).toBeUndefined();

    push(tick({ ltp: 24013 }));
    expect(cell?.dataset.flash).toBe("up");
    push(tick({ ltp: 24010 }));
    expect(cell?.dataset.flash).toBe("down");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(cell?.dataset.flash).toBeUndefined();
  });

  it("shows a grey dot once no tick arrived for five seconds", () => {
    const { container } = render(<PriceCell instrumentKey={KEY} size="lg" />);
    push(tick({ receivedAt: 1_000 }));
    expect(container.querySelector('[data-slot="stale-dot"]')).toBeNull();
    act(() => {
      marketActions.tickClock(6_500);
    });
    expect(container.querySelector('[data-slot="price-cell"]')).toHaveAttribute("data-stale", "true");
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });
});

function Subscriber({ keys }: { keys: string[] }) {
  useSubscribe(keys);
  return null;
}

describe("RealtimeProvider and FeedStatus", () => {
  it("connects on the first subscription, shows the feed state and closes on unmount", async () => {
    const socket = new FakeSocket();
    const createSocket = vi.fn(() => Promise.resolve(socket));
    const { container, unmount } = render(
      <RealtimeProvider url="http://localhost:4000" createSocket={createSocket}>
        <FeedStatus />
        <Subscriber keys={[KEY]} />
      </RealtimeProvider>,
    );
    await act(settle);
    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Connecting…");

    act(() => {
      socket.serverConnect();
      socket.fire("status", { feed: "up" });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Live");
    expect(socket.emitsOf("sub")).toEqual([{ keys: [KEY] }]);
    act(() => {
      socket.fire("status", { feed: "stale" });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Feed delayed");
    act(() => {
      socket.fire("status", { feed: "down" });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Feed down");
    await expectNoAxeViolations(container);

    act(() => {
      socket.serverDisconnect(true);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…");
    act(() => {
      socket.serverDisconnect(false);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Live prices unavailable");
    act(() => {
      screen.getByRole("button", { name: "Retry" }).click();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Live");

    unmount();
    expect(socket.closed).toBe(true);
  });
});
