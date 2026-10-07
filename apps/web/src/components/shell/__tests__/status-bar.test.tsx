import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AS_OF, marketOverview } from "@/features/market/__tests__/fixtures";
import { marketActions } from "@/features/realtime/store";
import { mockApi } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { StatusBar } from "../status-bar";

vi.mock("@/features/realtime/components/realtime-provider", () => ({
  useRealtimeClient: () => null,
}));

const ACCOUNT = {
  id: "a1",
  broker: "UPSTOX",
  label: "Upstox",
  status: "NEEDS_RELOGIN",
  isDefault: true,
  tokenExpiresAt: null,
  lastLoginAt: null,
  lastError: null,
};

function serve(accounts: unknown[] = [ACCOUNT]) {
  return mockApi([
    { path: "/v1/market/overview", respond: () => Response.json(marketOverview()) },
    { path: "/v1/brokers", respond: () => Response.json(accounts) },
  ]);
}

beforeEach(() => {
  marketActions.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(AS_OF)); // Tue 13:30 IST
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StatusBar", () => {
  it("shows the market countdowns, the broker connections and the IST clock, and nothing else", async () => {
    serve();
    const { container } = renderWithProviders(<StatusBar />);

    const footer = screen.getByRole("contentinfo", { name: "Status bar" });
    expect(footer).toHaveClass("h-8", "bg-surface-1", "border-t", "shrink-0");
    const timers = await within(footer).findByRole("list", { name: "Market timings" });
    expect(
      within(timers)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["NSECloses in 2h 00m", "MCXCloses in 10h 00m"]);
    const broker = await within(footer).findByRole("link", { name: /Upstox/ });
    expect(broker).toHaveTextContent("UpstoxLogin needed");
    expect(broker).toHaveAttribute("href", "/brokers");
    expect(footer.querySelector('[data-slot="ist-clock"]')).toHaveTextContent(/^\d{2}:\d{2}:\d{2} IST$/);
    expect(footer).not.toHaveTextContent(/market risks|v0\./);
    await expectNoAxeViolations(container);
  });

  it("offers to connect when there's no broker account", async () => {
    serve([]);
    renderWithProviders(<StatusBar />);
    expect(await screen.findByRole("link", { name: /No broker/ })).toHaveAttribute("href", "/brokers");
  });

  it("keeps NSE and the clock below 768 px", async () => {
    serve();
    renderWithProviders(<StatusBar />);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    const [nse, mcx] = screen.getAllByRole("listitem");
    expect(nse).not.toHaveClass("hidden");
    expect(mcx).toHaveClass("hidden", "md:flex");
  });
});
