import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signOutAction } from "@/features/auth/actions";
import { useUiStore } from "@/stores/ui.store";
import { expectNoAxeViolations } from "@/test/axe";
import { navigation, nextNavigationMock, router } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";

import { CommandPalette, paletteFilter } from "../command-palette";
import { MobileNav } from "../mobile-nav";
import { UserMenu } from "../user-menu";
import { initialsFor } from "../user-avatar";

vi.mock("next/navigation", () => nextNavigationMock);
vi.mock("@/features/auth/actions", () => ({ signOutAction: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
});

afterEach(() => {
  act(() => {
    useUiStore.setState({ sidebarCollapsed: false, mobileNavOpen: false, commandOpen: false });
  });
  navigation.pathname = "/dashboard";
});

describe("UserMenu", () => {
  const user = { id: "u1", name: "Asha Rao", email: "asha@example.com", image: null };

  it("shows who is signed in and signs out", async () => {
    const actor = userEvent.setup();
    renderWithProviders(<UserMenu user={user} />);
    await actor.click(screen.getByRole("button", { name: "Account menu for Asha Rao" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent("Asha Rao");
    expect(menu).toHaveTextContent("asha@example.com");
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(within(menu).getByRole("menuitem", { name: "Brokers" })).toHaveAttribute("href", "/brokers");
    await expectNoAxeViolations(menu);

    await actor.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => {
      expect(signOutAction).toHaveBeenCalledOnce();
    });
  });

  it("falls back to the email when there is no name", () => {
    renderWithProviders(<UserMenu user={{ ...user, name: null }} />);
    expect(screen.getByRole("button", { name: "Account menu for asha@example.com" })).toBeInTheDocument();
  });
});

describe("initialsFor", () => {
  it("uses up to two initials, else the email's first letter", () => {
    expect(initialsFor("Asha Rao Kumar", "a@b.c")).toBe("AR");
    expect(initialsFor(null, "zed@b.c")).toBe("Z");
    expect(initialsFor("  ", "q@b.c")).toBe("Q");
  });
});

describe("CommandPalette", () => {
  function open() {
    act(() => {
      useUiStore.getState().setCommandOpen(true);
    });
  }

  it("filters sections and navigates to the chosen one", async () => {
    const actor = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    open();
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await expectNoAxeViolations(dialog);

    await actor.type(within(dialog).getByRole("combobox"), "watch");
    await actor.keyboard("{Enter}");

    expect(router.push).toHaveBeenCalledWith("/watchlists");
    expect(useUiStore.getState().commandOpen).toBe(false);
  });

  it("lists every section under the sidebar's groups, the ones still to come marked", async () => {
    renderWithProviders(<CommandPalette />);
    open();
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });

    const markets = within(dialog).getByRole("group", { name: "Markets" });
    expect(
      within(markets)
        .getAllByRole("option")
        .map((option) => option.getAttribute("data-value")),
    ).toEqual(["Watchlists", "Charts", "Option Chain", "Markets"]);
    expect(within(markets).getByRole("option", { name: "Option Chain, coming soon" })).toBeInTheDocument();
    for (const name of ["Overview", "Trading", "Algo", "Account", "Actions"]) {
      expect(within(dialog).getByRole("group", { name })).toBeInTheDocument();
    }
  });

  it("goes to a coming-soon section too", async () => {
    const actor = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    open();

    await actor.type(await screen.findByRole("combobox"), "backtests");
    await actor.keyboard("{Enter}");

    expect(router.push).toHaveBeenCalledWith("/backtests");
  });

  it("toggles the sidebar", async () => {
    const actor = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    open();
    await actor.click(await screen.findByRole("option", { name: /Toggle sidebar/ }));
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it("switches the theme and saves it to the account", async () => {
    const actor = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    open();
    await actor.click(await screen.findByRole("option", { name: "Dark theme" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });
    expect(fetch).toHaveBeenCalledWith(
      "/v1/me/settings",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ appearance: { theme: "dark" } }) }),
    );
  });

  it("signs out", async () => {
    const actor = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    open();
    await actor.click(await screen.findByRole("option", { name: "Sign out" }));
    await waitFor(() => {
      expect(signOutAction).toHaveBeenCalled();
    });
  });

  it("matches labels before keywords, and hides what doesn't match at all", () => {
    expect(paletteFilter("Backtests", "back", ["Algo"])).toBe(1);
    expect(paletteFilter("Option Chain", "chain", [])).toBe(0.9);
    expect(paletteFilter("P&L", "&", [])).toBe(0.8);
    expect(paletteFilter("Markets", "global", ["Indices, movers, global markets"])).toBe(0.5);
    expect(paletteFilter("Markets", "backtests", ["Indices, movers, global markets"])).toBe(0);
    expect(paletteFilter("Charts", "  ", undefined)).toBe(1);
  });

  it("says when nothing matches", async () => {
    const actor = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    open();
    await actor.type(await screen.findByRole("combobox"), "zzzz");
    expect(await screen.findByText("No matches.")).toBeInTheDocument();
  });
});

describe("MobileNav", () => {
  it("opens a labelled sheet and closes it after navigating", async () => {
    const actor = userEvent.setup();
    navigation.pathname = "/watchlists";
    renderWithProviders(<MobileNav />);
    await actor.click(screen.getByRole("button", { name: "Open navigation" }));

    const sheet = await screen.findByRole("dialog", { name: "Navigation" });
    expect(within(sheet).getByRole("link", { name: "Watchlists" })).toHaveAttribute("aria-current", "page");
    await expectNoAxeViolations(sheet);

    expect(within(sheet).getByRole("link", { name: "Paper trading: orders are simulated" })).toBeInTheDocument();
    await actor.click(within(sheet).getByRole("link", { name: "Charts" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument();
    });
  });

  it("closes with the close button", async () => {
    const actor = userEvent.setup();
    renderWithProviders(<MobileNav />);
    await actor.click(screen.getByRole("button", { name: "Open navigation" }));
    await actor.click(await screen.findByRole("button", { name: "Close navigation" }));
    expect(useUiStore.getState().mobileNavOpen).toBe(false);
  });
});
