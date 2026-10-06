import { ThemeProvider } from "@finlytics/ui/components/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock } from "@/test/next-mocks";
import { renderWithProviders, testQueryClient } from "@/test/render";
import { useUiStore } from "@/stores/ui.store";

import { AppShell } from "../app-shell";

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
    fireEvent.focus(screen.getByRole("link", { name: "Option Chain" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Option Chain");
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
