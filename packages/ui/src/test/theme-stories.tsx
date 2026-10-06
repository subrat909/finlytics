/**
 * Helpers for stories that own <html data-theme> through ThemeProvider (tag `visual-single-theme`): the preview's
 * theme decorator leaves them alone, so each one wraps itself in a provider and decides what's stored.
 */
import type { Decorator } from "@storybook/react-vite";

import { ThemeProvider } from "../components/theme-provider";
import { THEME_STORAGE_KEY } from "../lib/theme";
import type { ThemePreference } from "../lib/theme";

/** Wraps the story in ThemeProvider. */
export const withThemeProvider: Decorator = (Story) => (
  <ThemeProvider>
    <Story />
  </ThemeProvider>
);

/**
 * A story `beforeEach` that stores `preference` on this device before rendering (none: nothing stored, so the default
 * applies), and restores what was stored before when the story is left. Stories that leave storage alone keep a
 * choice across reloads instead.
 */
export function storedTheme(preference: ThemePreference | null): () => () => void {
  return () => {
    const previous = localStorage.getItem(THEME_STORAGE_KEY);
    if (preference === null) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
    return () => {
      if (previous === null) localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, previous);
    };
  };
}
