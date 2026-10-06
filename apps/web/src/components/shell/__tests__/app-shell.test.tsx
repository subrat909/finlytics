import { ThemeProvider } from "@finlytics/ui/components/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock } from "@/test/next-mocks";
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

  it("lists the five sections in the sidebar, in order", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Main" });

    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Dashboard", "Watchlists", "Charts", "Brokers", "Settings"]);
  });

  it("puts the sidebar toggle and the centred search in the top bar, and no theme switch", () => {
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
    expect(topbar).toHaveClass("bg-surface-1", "border-b", "border-border");
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
