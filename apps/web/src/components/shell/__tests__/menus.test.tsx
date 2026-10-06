import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signOutAction } from "@/features/auth/actions";
import { useUiStore } from "@/stores/ui.store";
import { expectNoAxeViolations } from "@/test/axe";
import { navigation, nextNavigationMock, router } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";

import { CommandPalette } from "../command-palette";
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
