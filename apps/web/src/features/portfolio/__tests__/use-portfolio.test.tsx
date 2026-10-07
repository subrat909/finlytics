import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { marketActions } from "@/features/realtime/store";
import type { Tick } from "@/features/realtime/schemas";
import { mockApi, problem } from "@/test/api-mock";
import { testQueryClient } from "@/test/render";

import { useLiveQuotes } from "../hooks/use-live-quotes";
import {
  portfolioErrorKind,
  portfolioPath,
  portfolioQueryKey,
  useFunds,
  useHoldings,
  usePositions,
  useRefreshPortfolio,
} from "../hooks/use-portfolio";

const FUNDS = {
  accountId: "acc_up",
  broker: "UPSTOX",
  asOf: "2026-10-06T05:00:00.000Z",
  availableMargin: "75000",
  usedMargin: "25000",
  collateral: "0",
  withdrawable: "70000",
};

function wrapperFor(client = testQueryClient()) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

afterEach(() => {
  marketActions.reset();
});

describe("portfolio hooks", () => {
  it("fetch the chosen account's funds, positions and holdings", async () => {
    const calls = mockApi([
      { path: "/v1/portfolio/funds?accountId=acc_up", respond: () => Response.json(FUNDS) },
      {
        path: "/v1/portfolio/positions?accountId=acc_up",
        respond: () => Response.json({ accountId: "acc_up", broker: "UPSTOX", asOf: FUNDS.asOf, positions: [] }),
      },
      {
        path: "/v1/portfolio/holdings?accountId=acc_up",
        respond: () => Response.json({ accountId: "acc_up", broker: "UPSTOX", asOf: FUNDS.asOf, holdings: [] }),
      },
    ]);
    const { wrapper } = wrapperFor();
    const { result } = renderHook(
      () => ({ funds: useFunds("acc_up"), positions: usePositions("acc_up"), holdings: useHoldings("acc_up") }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.holdings.isSuccess).toBe(true);
    });
    expect(result.current.funds.data?.availableMargin).toBe("75000");
    expect(result.current.positions.data?.positions).toEqual([]);
    expect(calls.map((call) => call.path)).toEqual([
      "/v1/portfolio/funds?accountId=acc_up",
      "/v1/portfolio/positions?accountId=acc_up",
      "/v1/portfolio/holdings?accountId=acc_up",
    ]);
  });

  it("ask for the default account without an id, and not at all while disabled", async () => {
    const calls = mockApi([{ path: "/v1/portfolio/funds", respond: () => Response.json(FUNDS) }]);
    const { wrapper } = wrapperFor();
    const disabled = renderHook(() => useFunds(undefined, { enabled: false }), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe("idle");
    expect(calls).toHaveLength(0);
    const { result } = renderHook(() => useFunds(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(portfolioQueryKey("funds")).toEqual(["portfolio", "funds", "default"]);
    expect(portfolioPath("holdings", "a b")).toBe("/v1/portfolio/holdings?accountId=a%20b");
  });

  it("tell a missing broker (404) from an ended session (409), which refreshes the broker list", async () => {
    const calls = mockApi([
      { path: "/v1/portfolio/funds", respond: () => problem(404, "NOT_FOUND") },
      { path: "/v1/portfolio/positions", respond: () => problem(409, "NEEDS_RELOGIN") },
    ]);
    const { client, wrapper } = wrapperFor();
    client.setQueryData(["brokers"], []);
    const { result } = renderHook(() => ({ funds: useFunds(), positions: usePositions() }), { wrapper });
    await waitFor(() => {
      expect(result.current.positions.isError).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.funds.isError).toBe(true);
    });
    expect(portfolioErrorKind(result.current.funds.error)).toBe("no_broker");
    expect(portfolioErrorKind(result.current.positions.error)).toBe("needs_relogin");
    expect(portfolioErrorKind(new Error("boom"))).toBe("error");
    expect(client.getQueryState(["brokers"])?.isInvalidated).toBe(true);
    expect(calls.some((call) => call.path === "/v1/portfolio/positions")).toBe(true);
  });

  it("refresh every portfolio query at once", async () => {
    let served = 0;
    mockApi([
      {
        path: "/v1/portfolio/funds",
        respond: () => {
          served += 1;
          return Response.json(FUNDS);
        },
      },
    ]);
    const { wrapper } = wrapperFor();
    const { result } = renderHook(() => ({ funds: useFunds(), refresh: useRefreshPortfolio() }), { wrapper });
    await waitFor(() => {
      expect(result.current.funds.isSuccess).toBe(true);
    });
    await act(() => result.current.refresh.refresh());
    expect(served).toBe(2);
    expect(result.current.refresh.refreshing).toBe(false);
  });
});

describe("useLiveQuotes", () => {
  it("reads the live price and the previous close of many keys, and follows new ticks", () => {
    const tick = (ltp: number, chg: number) => ({ ltp, chg, chgPct: 0, vol: null, ts: 1, receivedAt: 1 }) as Tick;
    act(() => {
      marketActions.applyTicks(new Map([["NSE_EQ|TCS", tick(3650, 50)]]));
    });
    const keys = ["NSE_EQ|TCS", "NSE_EQ|INFY"];
    const { result } = renderHook(() => useLiveQuotes(keys));
    expect(result.current.get("NSE_EQ|TCS")).toEqual({ ltp: 3650, prevClose: 3600 });
    expect(result.current.has("NSE_EQ|INFY")).toBe(false);
    act(() => {
      marketActions.applyTicks(new Map([["NSE_EQ|INFY", tick(1500, -10)]]));
    });
    expect(result.current.get("NSE_EQ|INFY")).toEqual({ ltp: 1500, prevClose: 1510 });
  });
});
