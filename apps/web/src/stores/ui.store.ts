/**
 * App-shell UI state (frontend.md "Sidebar"; plan W10). `sidebarCollapsed` is persisted in localStorage under
 * `finlytics-ui`, and mirrored to the `finlytics-sidebar` cookie so the server renders the right width on the next
 * load (no expand-then-collapse flash). Read it with a selector: `useUiStore((s) => s.sidebarCollapsed)`.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const UI_STORAGE_KEY = "finlytics-ui";
export const SIDEBAR_COOKIE = "finlytics-sidebar";

export interface UiState {
  sidebarCollapsed: boolean;
  /** The < 1024 px navigation sheet. */
  mobileNavOpen: boolean;
  /** The ⌘K command palette. */
  commandOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
}

/** Writes the SSR hint cookie (a preference, not a secret: readable by scripts, sent to this origin only). */
export function writeSidebarCookie(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandOpen: false,
      toggleSidebar: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },
      setSidebarCollapsed: (collapsed) => {
        set({ sidebarCollapsed: collapsed });
      },
      setMobileNavOpen: (open) => {
        set({ mobileNavOpen: open });
      },
      setCommandOpen: (open) => {
        set({ commandOpen: open });
      },
    }),
    {
      name: UI_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only the preference persists; open dialogs never survive a reload.
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
