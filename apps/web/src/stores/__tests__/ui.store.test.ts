// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { SIDEBAR_COOKIE, UI_STORAGE_KEY, useUiStore, writeSidebarCookie } from "../ui.store";

afterEach(() => {
  useUiStore.setState({ sidebarCollapsed: false, mobileNavOpen: false, commandOpen: false });
  localStorage.clear();
});

describe("useUiStore", () => {
  it("toggles the sidebar and persists only that preference", () => {
    useUiStore.getState().toggleSidebar();
    useUiStore.getState().setCommandOpen(true);
    useUiStore.getState().setMobileNavOpen(true);

    expect(useUiStore.getState()).toMatchObject({ sidebarCollapsed: true, commandOpen: true, mobileNavOpen: true });
    expect(JSON.parse(localStorage.getItem(UI_STORAGE_KEY) ?? "{}")).toEqual({
      state: { sidebarCollapsed: true },
      version: 1,
    });

    useUiStore.getState().setSidebarCollapsed(false);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });
});

describe("writeSidebarCookie", () => {
  it("mirrors the preference for the server render", () => {
    writeSidebarCookie(true);
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);
    writeSidebarCookie(false);
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=expanded`);
  });
});
