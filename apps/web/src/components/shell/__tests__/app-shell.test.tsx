import { ThemeProvider } from "@finlytics/ui/components/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketOverview } from "@/features/market/__tests__/fixtures";
import { mockApi } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { navigation, nextNavigationMock } from "@/test/next-mocks";
import { renderWithProviders, testQueryClient } from "@/test/render";
import { useUiStore } from "@/stores/ui.store";

import { AppShell } from "../app-shell";
import { TooltipProvider } from "../tooltip";

vi.mock("next/navigation", () => nextNavigationMock);
vi.mock("@/features/auth/actions", () => ({ signOutAction: vi.fn() }));

const USER = { id: "u1", name: "Asha Rao", email: "asha@example.com", image: null };

function renderShell(initialCollapsed = false) {
  return renderWithProviders(
    <AppShell user={USER} initialCollapsed={initialCollapsed}>
      <p>Page content</p>
    </AppShell>,
  );
}

/** Long enough for the tooltip provider's 250 ms open delay, and then some. */
function pastTooltipDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 400);
  });
}

beforeEach(() => {
  mockApi([
    { path: "/v1/market/overview", respond: () => Response.json(marketOverview()) },
    { path: "/v1/notifications", respond: () => Response.json({ items: [], unread: 0 }) },
    { path: "/v1/brokers", respond: () => Response.json([]) },
  ]);
});

afterEach(() => {
  act(() => {
    useUiStore.setState({ sidebarCollapsed: false, mobileNavOpen: false, commandOpen: false });
  });
});

describe("AppShell", () => {
  it("renders the landmarks, a skip link and the page, with no axe violations", async () => {
    const { container } = renderShell();
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("Page content");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    await expectNoAxeViolations(container);
  });

  it("collapses the sidebar with the toggle without re-mounting the page", async () => {
    const user = userEvent.setup();
    renderShell();
    const main = screen.getByRole("main");
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(sidebar).toHaveClass("w-64", "transition-[width]");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(sidebar).toHaveClass("w-16");
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("main")).toBe(main);
    expect(main.parentElement).toHaveClass("lg:ml-16", "transition-[margin]");
    expect(document.cookie).toContain("finlytics-sidebar=collapsed");
    // Labels fade but keep the accessible names.
    expect(screen.getByRole("link", { name: "Charts" })).toBeInTheDocument();
  });

  it("toggles the sidebar with [ but not while typing", () => {
    renderShell();
    fireEvent.keyDown(window, { key: "[" });
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "[" });
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    input.remove();

    fireEvent.keyDown(window, { key: "[", ctrlKey: true });
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it("shows a tooltip on a nav link only while collapsed", async () => {
    renderShell();
    fireEvent.focus(screen.getByRole("link", { name: "Charts" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => {
      useUiStore.getState().setSidebarCollapsed(true);
    });
    fireEvent.blur(screen.getByRole("link", { name: "Charts" }));
    fireEvent.focus(screen.getByRole("link", { name: "Watchlists" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Watchlists");
  });

  it("groups the sections in the sidebar, in order, and marks the ones still to come", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Main" });

    expect(
      within(nav)
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Overview", "Markets", "Trading", "Algo", "Account"]);
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/dashboard",
      "/watchlists",
      "/charts",
      "/option-chain",
      "/markets",
      "/orders",
      "/positions",
      "/pnl",
      "/strategies",
      "/backtests",
      "/agents",
      "/alerts",
      "/brokers",
      "/settings",
    ]);
    const optionChain = within(nav).getByRole("link", { name: "Option Chain, coming soon" });
    expect(optionChain).toHaveAttribute("data-soon", "true");
    expect(within(optionChain).getByText("Soon")).toHaveAttribute("aria-hidden", "true");
    expect(within(nav).getByRole("link", { name: "Charts" })).not.toHaveAttribute("data-soon");
  });

  it("marks the current page with the primary bar, and shows the trading mode at the foot", () => {
    navigation.pathname = "/watchlists";
    renderShell();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });

    const current = within(sidebar).getByRole("link", { name: "Watchlists" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveClass("aria-[current=page]:before:bg-primary", "aria-[current=page]:bg-surface-2");
    expect(within(sidebar).getByRole("link", { name: "Paper trading: orders are simulated" })).toHaveAttribute(
      "href",
      "/settings#trading",
    );
    navigation.pathname = "/dashboard";
  });

  it("swaps the group headings for rules when collapsed, keeping every row in place", async () => {
    const user = userEvent.setup();
    renderShell();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    const heading = within(sidebar).getByRole("heading", { name: "Markets" });
    const rule = heading.parentElement?.querySelector('[data-slot="sidebar-group-rule"]');
    expect(heading).not.toHaveClass("opacity-0");
    expect(rule).toHaveClass("opacity-0");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(heading).toHaveClass("opacity-0");
    expect(rule).toHaveClass("opacity-100");
    expect(within(sidebar).getByRole("heading", { name: "Markets" })).toBe(heading);
  });

  it("never shows a tooltip for a link hovered while expanded once the sidebar collapses (regression)", async () => {
    const user = userEvent.setup();
    renderShell();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });

    // Expanded: labels show, so hovering a link opens nothing, even past the delay.
    await user.hover(within(sidebar).getByRole("link", { name: "Charts" }));
    await act(pastTooltipDelay);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.hover(within(sidebar).getByRole("link", { name: "Brokers" }));
    await act(pastTooltipDelay);

    // Collapsing (here with `[`) shows none of them by itself.
    fireEvent.keyDown(window, { key: "[" });
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    await act(pastTooltipDelay);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // A hover while collapsed shows that link's tooltip, and only it.
    await user.hover(within(sidebar).getByRole("link", { name: "Watchlists" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Watchlists");
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  });

  it("puts the status bar under the page, outside the scroll container", () => {
    renderShell();
    const footer = screen.getByRole("contentinfo", { name: "Status bar" });

    expect(footer.previousElementSibling).toBe(screen.getByRole("main"));
    expect(screen.getByRole("main")).toHaveClass("overflow-y-auto", "flex-1", "min-h-0");
    // A fixed, viewport-sized column: the document never scrolls, so navbar, sidebar and footer never move.
    expect(footer.parentElement).toHaveClass("fixed", "inset-0", "flex-col", "overflow-hidden");
  });

  it("puts the sidebar toggle, the search, the market status and the bell in the top bar, no ticker or theme switch", async () => {
    renderShell();
    const topbar = screen.getByRole("banner");

    const toggle = within(topbar).getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-controls", "app-sidebar");
    expect(toggle).toHaveAttribute("aria-keyshortcuts", "[");
    const search = topbar.querySelector('[data-slot="search-trigger"]');
    expect(search).toHaveAttribute("data-slot", "search-trigger");
    // Named by its visible text (no aria-label, so axe's label-content-name-mismatch can't trip). jsdom drops the
    // space at the start of the inner span; browsers keep it, and the e2e checks the real name.
    expect(search).toHaveAccessibleName(/^Search\s?sections and actions/);
    expect(topbar).toHaveClass("bg-surface-1", "border-b", "border-border", "h-14", "shrink-0");
    expect(within(topbar).queryByRole("list", { name: "Market indices" })).not.toBeInTheDocument();
    expect(topbar.querySelector('[data-slot="market-status"]')).toBeInTheDocument();
    expect(await within(topbar).findByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toHaveClass("border-r", "border-border");
  });

  it("renders the page full width, without a max-width container", () => {
    renderShell();

    expect(screen.getByRole("main").className).not.toMatch(/max-w-/);
    expect(screen.getByRole("main")).toHaveClass("w-full");
  });

  it("shows a banner between the top bar and the page without re-mounting the page", () => {
    const client = testQueryClient();
    function Providers({ children }: { children: React.ReactNode }) {
      return (
        <ThemeProvider>
          <QueryClientProvider client={client}>
            <TooltipProvider>{children}</TooltipProvider>
          </QueryClientProvider>
        </ThemeProvider>
      );
    }
    const { rerender } = render(
      <AppShell user={USER} initialCollapsed={false}>
        <p>Page content</p>
      </AppShell>,
      { wrapper: Providers },
    );
    const main = screen.getByRole("main");
    expect(document.querySelector('[data-slot="shell-banner"]')).toBeNull();

    rerender(
      <AppShell user={USER} initialCollapsed={false} banner={<p>Your Upstox session expired.</p>}>
        <p>Page content</p>
      </AppShell>,
    );

    const banner = document.querySelector('[data-slot="shell-banner"]');
    expect(banner).toHaveTextContent("Your Upstox session expired.");
    expect(banner?.previousElementSibling).toBe(screen.getByRole("banner"));
    expect(banner?.nextElementSibling).toBe(main);
    expect(screen.getByRole("main")).toBe(main);
  });

  it("opens and closes the command palette with Ctrl+K", async () => {
    renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(dialog).getByRole("combobox")).toHaveFocus();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    });
  });

  it("opens the palette from the search button", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getAllByRole("button", { name: /Search/ })[0] as HTMLElement);
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("server-renders the width the cookie asked for", () => {
    const html = renderToString(
      <ThemeProvider>
        <QueryClientProvider client={testQueryClient()}>
          <AppShell user={USER} initialCollapsed>
            <p>Page</p>
          </AppShell>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(html).toContain('data-collapsed="true"');
    expect(html).toContain("lg:ml-16");
  });
});
