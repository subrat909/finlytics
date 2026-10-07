import { act, screen } from "@testing-library/react";
import { useState } from "react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, problem } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { FeedStatus } from "../components/feed-status";
import { RealtimeProvider } from "../components/realtime-provider";
import { SimulatedBadge } from "../components/simulated-badge";
import { useDepth } from "../hooks/use-depth";
import { useFeedSource, useSubscribe } from "../hooks/use-realtime";
import { marketActions, useMarketStore } from "../store";

import { FakeSocket, settle } from "./fake-socket";

const KEY = "NSE_EQ|INFY";
const SNAPSHOT = { k: KEY, t: 100, bids: [["1500", 10, 2]], asks: [["1500.5", 7, 1]], tbq: 900, tsq: 800 };

function DepthProbe({ instrumentKey }: { instrumentKey: string | undefined }) {
  const { depth, loading, rejected } = useDepth(instrumentKey);
  return (
    <p data-testid="probe">
      {loading ? "loading" : depth === undefined ? `none:${rejected ?? ""}` : `bid:${String(depth.bids[0]?.price)}`}
    </p>
  );
}

/** Shows the probe until "Hide" is clicked: unmounts it while the provider (and the socket) stays. */
function Toggle({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setShown(false);
        }}
      >
        Hide
      </button>
      {shown ? children : null}
    </>
  );
}

function Subscriber() {
  useSubscribe([KEY]);
  return null;
}

function SourceProbe() {
  const source = useFeedSource();
  return <p data-testid="source">{source === undefined ? "unknown" : `${source.source}:${String(source.live)}`}</p>;
}

function renderLive(ui: React.ReactElement) {
  const socket = new FakeSocket();
  const view = renderWithProviders(
    <RealtimeProvider url="http://localhost:4000" createSocket={() => Promise.resolve(socket)}>
      {ui}
    </RealtimeProvider>,
  );
  return { socket, ...view };
}

beforeEach(() => {
  marketActions.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDepth", () => {
  it("seeds from the last snapshot, streams over the socket and releases on unmount", async () => {
    const calls = mockApi([
      { path: `/v1/quotes/depth?key=${encodeURIComponent(KEY)}`, respond: () => Response.json(SNAPSHOT) },
    ]);
    const { socket } = renderLive(
      <Toggle>
        <DepthProbe instrumentKey={KEY} />
      </Toggle>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("loading");
    expect(await screen.findByText("bid:1500")).toBeInTheDocument();
    expect(calls.map((call) => call.path)).toEqual([`/v1/quotes/depth?key=${encodeURIComponent(KEY)}`]);

    await act(settle);
    act(() => {
      socket.serverConnect();
    });
    const sub = socket.emitted.find((entry) => entry.event === "sub");
    act(() => {
      sub?.ack?.({ ok: [KEY], rejected: [] });
    });
    await act(settle);
    expect(socket.emitsOf("dsub")).toEqual([{ key: KEY }]);

    // A streamed book replaces the snapshot (written in the client's next frame).
    act(() => {
      marketActions.applyDepth(
        new Map([
          [KEY, { t: 200, bids: [{ price: 1501, qty: 1, orders: 1 }], asks: [], tbq: null, tsq: null, receivedAt: 1 }],
        ]),
      );
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("bid:1501");

    act(() => {
      screen.getByRole("button", { name: "Hide" }).click();
    });
    await act(settle);
    expect(socket.emitsOf("dunsub")).toEqual([{ key: KEY }]);
    expect(socket.emitsOf("unsub")).toEqual([{ keys: [KEY] }]);
    expect(useMarketStore.getState().depth.has(KEY)).toBe(false);
  });

  it("shows nothing (not an error) without a snapshot, and the reason when the stream is refused", async () => {
    mockApi([{ path: /^\/v1\/quotes\/depth/, respond: () => problem(404, "NOT_FOUND") }]);
    renderWithProviders(<DepthProbe instrumentKey={KEY} />);
    expect(await screen.findByText("none:")).toBeInTheDocument();
    act(() => {
      marketActions.setDepthRejected(KEY, "limit");
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("none:limit");
  });

  it("asks for nothing without a key", () => {
    const calls = mockApi([]);
    renderWithProviders(<DepthProbe instrumentKey={undefined} />);
    expect(screen.getByTestId("probe")).toHaveTextContent("none:");
    expect(calls).toEqual([]);
  });

  it("ignores a snapshot for another key", async () => {
    mockApi([{ path: /^\/v1\/quotes\/depth/, respond: () => Response.json({ ...SNAPSHOT, k: "NSE_EQ|TCS" }) }]);
    renderWithProviders(<DepthProbe instrumentKey={KEY} />);
    expect(await screen.findByText("none:")).toBeInTheDocument();
    expect(useMarketStore.getState().depth.size).toBe(0);
  });
});

describe("feed source", () => {
  it("labels simulated prices and stays hidden while the feed is live or unknown", async () => {
    const { container } = renderWithProviders(
      <div>
        <SourceProbe />
        <SimulatedBadge />
      </div>,
    );
    expect(screen.getByTestId("source")).toHaveTextContent("unknown");
    expect(container.querySelector('[data-slot="simulated-badge"]')).toBeNull();

    act(() => {
      marketActions.setSource({ source: "PAPER", live: false });
    });
    expect(screen.getByTestId("source")).toHaveTextContent("PAPER:false");
    expect(screen.getByText("Simulated")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    act(() => {
      marketActions.setSource({ source: "UPSTOX", live: true });
    });
    expect(container.querySelector('[data-slot="simulated-badge"]')).toBeNull();
  });

  it("shows a compact status with the full label for screen readers and an icon-only retry", async () => {
    const { socket, container } = renderLive(
      <>
        <FeedStatus compact />
        <Subscriber />
      </>,
    );
    await act(settle);
    act(() => {
      socket.serverDisconnect(false);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
    expect(screen.getByRole("status")).toHaveTextContent("Live prices unavailable");
    await expectNoAxeViolations(container);
    act(() => {
      screen.getByRole("button", { name: "Retry" }).click();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Live");
  });
});
