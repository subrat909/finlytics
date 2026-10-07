import type { BrokerAccountView } from "@finlytics/shared";
import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketActions } from "@/features/realtime/store";
import { mockApi, problem } from "@/test/api-mock";
import type { ApiRoute } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { navigation, nextNavigationMock } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";
import { toast } from "@/stores/toast.store";

import { DashboardView, pickAccount } from "../components/dashboard-view";
import { useThrottledValue } from "../hooks/use-throttled-value";

import { AUTH_URL, DHAN, FUNDS, HOLDINGS, NOW, PAPER, POSITIONS, UPSTOX, overview, tick } from "./fixtures";

vi.mock("next/navigation", () => nextNavigationMock);

interface Options {
  accounts?: BrokerAccountView[];
  live?: boolean;
  extra?: ApiRoute[];
}

/** Every read the dashboard makes, for the default (Upstox) account unless `extra` answers first. */
function dashboardRoutes({ accounts = [UPSTOX], live = true, extra = [] }: Options = {}): ApiRoute[] {
  return [
    ...extra,
    { path: "/v1/brokers", respond: () => Response.json(accounts) },
    { path: "/v1/market/overview", respond: () => Response.json(overview(live)) },
    { path: "/v1/watchlists", respond: () => Response.json([]) },
    { path: /^\/v1\/portfolio\/funds\?accountId=acc_up$/, respond: () => Response.json(FUNDS) },
    { path: /^\/v1\/portfolio\/positions\?accountId=acc_up$/, respond: () => Response.json(POSITIONS) },
    { path: /^\/v1\/portfolio\/holdings\?accountId=acc_up$/, respond: () => Response.json(HOLDINGS) },
  ];
}

function kpi(slot: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-kpi="${slot}"]`);
  if (element === null) throw new Error(`no KPI ${slot}`);
  return element;
}

function positionRow(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-slot="position-row"][data-instrument-key="${key}"]`);
  if (element === null) throw new Error(`no position ${key}`);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  navigation.pathname = "/dashboard";
  marketActions.reset();
});

afterEach(() => {
  vi.useRealTimers();
  marketActions.reset();
  act(() => {
    toast.clear();
  });
});

describe("DashboardView", () => {
  it("shows a shaped skeleton, then the key figures, positions, market, holdings, broker health and automation", async () => {
    mockApi(dashboardRoutes());
    const { container } = renderWithProviders(<DashboardView />);
    expect(screen.getByRole("status", { name: "Loading dashboard" })).toBeInTheDocument();

    const positions = await screen.findByRole("table", { name: "Positions" });
    // Day P&L: RELIANCE (2910 − 2900) × 50 = 500, the short call (110 − 120) × −75 = 750, INFY realised −100.
    expect(kpi("day-pnl")).toHaveTextContent("+₹1,150.00");
    expect(kpi("day-pnl")).toHaveTextContent("Realised -₹100.00 · Unrealised +₹1,250.00");
    expect(kpi("funds")).toHaveTextContent("₹75,000.00");
    expect(kpi("margin")).toHaveTextContent("₹25,000.00");
    expect(within(kpi("margin")).getByRole("meter", { name: "Margin used" })).toHaveAttribute("aria-valuenow", "25");
    expect(kpi("open-positions")).toHaveTextContent("2");
    expect(kpi("open-positions")).toHaveTextContent("1 long · 1 short · 1 closed today");
    // Holdings: 10 × 3600 + 20 × 1580 = 67,600; today (3600 − 3550) × 10 + (1580 − 1590) × 20 = +300.
    expect(kpi("holdings")).toHaveTextContent("₹67.6 K");
    expect(kpi("holdings")).toHaveTextContent("+₹300");

    expect(within(positions).getAllByRole("row")).toHaveLength(4);
    expect(within(positionRow("NSE_EQ|RELIANCE")).getByText("MIS")).toBeInTheDocument();
    expect(positionRow("NSE_EQ|RELIANCE")).toHaveTextContent("+₹500.00");
    expect(positionRow("NSE_FO|NIFTY|2026-10-27|24000|CE")).toHaveTextContent("NRML");
    expect(within(positionRow("NSE_EQ|RELIANCE")).getByRole("link", { name: "RELIANCE" })).toHaveAttribute(
      "href",
      `/charts?key=${encodeURIComponent("NSE_EQ|RELIANCE")}`,
    );

    const market = screen.getByRole("region", { name: "Market" });
    expect(within(market).getByRole("table", { name: "Indices" })).toHaveTextContent("NIFTY 50");
    expect(within(market).getByText("NSE open")).toBeInTheDocument();
    expect(within(market).queryByText("Simulated")).toBeNull();
    expect(within(market).getByRole("img", { name: "32 advancing, 16 declining, 2 unchanged" })).toBeInTheDocument();

    expect(screen.getByRole("region", { name: "Holdings" })).toHaveTextContent("TCS");
    const health = screen.getByRole("region", { name: "Broker health" });
    expect(within(health).getByText("Live · Upstox")).toBeInTheDocument();
    expect(within(health).getByText("Feeds market data")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Risk & automation" })).toHaveTextContent("Paper");

    expect(screen.getByText("10:32:09 IST")).toBeInTheDocument();
    expect(screen.getByText("Upstox · Main")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("re-prices positions and the day's P&L from live ticks", async () => {
    mockApi(dashboardRoutes());
    renderWithProviders(<DashboardView />);
    await screen.findByRole("table", { name: "Positions" });

    act(() => {
      marketActions.applyTicks(
        new Map([
          ["NSE_EQ|RELIANCE", tick(2920)],
          ["NSE_FO|NIFTY|2026-10-27|24000|CE", tick(100)],
        ]),
      );
    });
    // 20 × 50 = 1,000 and (120 − 100) × 75 = 1,500, less INFY's realised 100.
    expect(positionRow("NSE_EQ|RELIANCE")).toHaveTextContent("+₹1,000.00");
    expect(positionRow("NSE_FO|NIFTY|2026-10-27|24000|CE")).toHaveTextContent("+₹1,500.00");
    expect(kpi("day-pnl")).toHaveTextContent("+₹2,400.00");
    // No previous close from the api yet: the day's move comes from the tick (ltp − chg).
    act(() => {
      marketActions.applyTicks(new Map([["NSE_EQ|RELIANCE", tick(2929, 29)]]));
    });
    expect(positionRow("NSE_EQ|RELIANCE").querySelector('[data-slot="position-day-change"]')).toHaveTextContent(
      "+1.00% today",
    );

    act(() => {
      marketActions.applyTicks(new Map([["NSE_EQ|RELIANCE", tick(2850)]]));
    });
    expect(positionRow("NSE_EQ|RELIANCE")).toHaveTextContent("-₹2,500.00");
    expect(positionRow("NSE_EQ|RELIANCE").querySelector('[data-slot="signed-money"]')).toHaveAttribute(
      "data-direction",
      "down",
    );
  });

  it("sorts positions by P&L, largest first, then ascending", async () => {
    const actor = userEvent.setup();
    mockApi(dashboardRoutes());
    renderWithProviders(<DashboardView />);
    const table = await screen.findByRole("table", { name: "Positions" });
    const order = () =>
      [...table.querySelectorAll('[data-slot="position-row"]')].map((row) => row.getAttribute("data-instrument-key"));

    await actor.click(within(table).getByRole("button", { name: /P&L/ }));
    expect(within(table).getByRole("columnheader", { name: /P&L/ })).toHaveAttribute("aria-sort", "descending");
    expect(order()).toEqual(["NSE_FO|NIFTY|2026-10-27|24000|CE", "NSE_EQ|RELIANCE", "NSE_EQ|INFY"]);
    await actor.click(within(table).getByRole("button", { name: /P&L/ }));
    expect(order()).toEqual(["NSE_EQ|INFY", "NSE_EQ|RELIANCE", "NSE_FO|NIFTY|2026-10-27|24000|CE"]);
  });

  it("shows the onboarding checklist and the simulated market without an ACTIVE broker", async () => {
    const calls = mockApi(dashboardRoutes({ accounts: [], live: false }));
    const { container } = renderWithProviders(<DashboardView />);
    const checklist = await screen.findByRole("region", { name: "Get started" });
    expect(
      within(checklist).getByRole("heading", { name: /Connect a broker to see your portfolio/ }),
    ).toBeInTheDocument();
    expect(within(checklist).getByRole("link", { name: "Connect broker" })).toHaveAttribute("href", "/brokers");
    expect(within(checklist).getByRole("link", { name: "Open watchlists" })).toHaveAttribute("href", "/watchlists");
    expect(within(checklist).getByText("Arrives in 4.x")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(checklist).getByText("0 of 2 done")).toBeInTheDocument();
    });

    const market = screen.getByRole("region", { name: "Market" });
    expect(await within(market).findByText("Simulated")).toBeInTheDocument();
    expect(within(market).getByText(/Prices are simulated/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Risk & automation" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Key figures" })).toBeNull();
    expect(calls.some((call) => call.path.startsWith("/v1/portfolio"))).toBe(false);
    await expectNoAxeViolations(container);
  });

  it("asks to log in again when the broker session ended mid-session (409)", async () => {
    const actor = userEvent.setup();
    const navigate = vi.fn();
    mockApi(
      dashboardRoutes({
        extra: [
          { path: /^\/v1\/portfolio\/funds/, respond: () => problem(409, "NEEDS_RELOGIN") },
          { path: /^\/v1\/portfolio\/positions/, respond: () => problem(409, "NEEDS_RELOGIN") },
          { path: /^\/v1\/portfolio\/holdings/, respond: () => problem(409, "NEEDS_RELOGIN") },
          {
            method: "POST",
            path: "/v1/brokers/acc_up/relogin",
            respond: () => Response.json({ account: UPSTOX, authUrl: AUTH_URL }),
          },
        ],
      }),
    );
    renderWithProviders(<DashboardView navigate={navigate} />);
    const prompt = await screen.findByRole("region", { name: "Your Upstox session “Main” has ended" });
    expect(screen.queryByRole("table", { name: "Positions" })).toBeNull();
    await actor.click(within(prompt).getByRole("button", { name: "Log in to Upstox" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(AUTH_URL);
    });
  });

  it("shows each panel's own error and empty states", async () => {
    const actor = userEvent.setup();
    let failPositions = true;
    mockApi(
      dashboardRoutes({
        extra: [
          {
            path: /^\/v1\/portfolio\/positions/,
            respond: () => (failPositions ? problem(500, "INTERNAL") : Response.json({ ...POSITIONS, positions: [] })),
          },
          { path: /^\/v1\/portfolio\/holdings/, respond: () => Response.json({ ...HOLDINGS, holdings: [] }) },
        ],
      }),
    );
    const { container } = renderWithProviders(<DashboardView />);
    const panel = await screen.findByRole("region", { name: "Positions" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Positions didn't load");
    expect(kpi("day-pnl")).toHaveTextContent("Unavailable");
    expect(await screen.findByRole("heading", { name: "No holdings yet" })).toBeInTheDocument();
    expect(kpi("holdings")).toHaveTextContent("No holdings");
    await expectNoAxeViolations(container);

    failPositions = false;
    await actor.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(await within(panel).findByRole("heading", { name: "No positions today" })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open charts" })).toHaveAttribute("href", "/charts");
  });

  it("shows a retryable error when the accounts don't load", async () => {
    const actor = userEvent.setup();
    let fail = true;
    mockApi(
      dashboardRoutes({
        extra: [
          { path: "/v1/brokers", respond: () => (fail ? problem(503, "SERVICE_UNAVAILABLE") : Response.json([])) },
        ],
      }),
    );
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText("Your dashboard didn't load", {}, { timeout: 5_000 })).toBeInTheDocument();
    fail = false;
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Get started" })).toBeInTheDocument();
  });

  it("switches between ACTIVE accounts", async () => {
    const actor = userEvent.setup();
    const calls = mockApi(
      dashboardRoutes({
        accounts: [UPSTOX, DHAN, { ...PAPER, status: "NEEDS_RELOGIN" }],
        extra: [
          {
            path: "/v1/portfolio/funds?accountId=acc_dh",
            respond: () => Response.json({ ...FUNDS, accountId: "acc_dh", broker: "DHAN", availableMargin: "1234.5" }),
          },
          {
            path: "/v1/portfolio/positions?accountId=acc_dh",
            respond: () => Response.json({ ...POSITIONS, accountId: "acc_dh", broker: "DHAN", positions: [] }),
          },
          {
            path: "/v1/portfolio/holdings?accountId=acc_dh",
            respond: () => Response.json({ ...HOLDINGS, accountId: "acc_dh", broker: "DHAN", holdings: [] }),
          },
        ],
      }),
    );
    renderWithProviders(<DashboardView />);
    const switcher = await screen.findByRole("combobox", { name: "Account" });
    expect(
      within(switcher)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Upstox · Main", "Dhan · Dhan swing"]);
    expect(switcher).toHaveValue("acc_up");
    await actor.selectOptions(switcher, "acc_dh");
    await waitFor(() => {
      expect(kpi("funds")).toHaveTextContent("₹1,234.50");
    });
    expect(calls.some((call) => call.path === "/v1/portfolio/positions?accountId=acc_dh")).toBe(true);
    expect(document.querySelector('[data-slot="page-header"]')).toHaveTextContent("Dhan · Dhan swing");
  });
});

describe("pickAccount", () => {
  it("prefers the chosen ACTIVE account, then the default, then the first", () => {
    expect(pickAccount([UPSTOX, DHAN], "acc_dh")?.id).toBe("acc_dh");
    expect(pickAccount([DHAN, UPSTOX], "gone")?.id).toBe("acc_up");
    expect(pickAccount([DHAN, { ...PAPER }], undefined)?.id).toBe("acc_dh");
    expect(pickAccount([], undefined)).toBeUndefined();
  });
});

describe("useThrottledValue", () => {
  it("passes changes through at most once per interval, keeping the latest", () => {
    vi.useFakeTimers({ now: NOW });
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 1_000), {
      initialProps: { value: "a" },
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    rerender({ value: "b" });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe("b");
    rerender({ value: "c" });
    rerender({ value: "d" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe("b");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe("d");
    vi.useRealTimers();
  });
});
