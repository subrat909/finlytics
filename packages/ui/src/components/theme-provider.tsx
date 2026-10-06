"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type * as React from "react";

import { useIsClient } from "../hooks/use-is-client";
import { THEME_STORAGE_KEY, isThemePreference } from "../lib/theme";
import type { ResolvedTheme, ThemePreference } from "../lib/theme";

// The theme names live in the directive-free lib/theme, where Server Components can read them. Re-exported here so
// client code that imports them from this module keeps working.
export { THEME_PREFERENCES, THEME_STORAGE_KEY, isThemePreference } from "../lib/theme";
export type { ResolvedTheme, ThemePreference } from "../lib/theme";

const RESOLVED_THEMES: ResolvedTheme[] = ["light", "dark"];

/**
 * Props for next-themes' pre-paint script. `data-cfasync="false"` stops Cloudflare Rocket Loader from deferring it.
 * The script only does its job in server-rendered HTML. When React creates it on the client (Storybook, a client
 * re-mount), React 19 logs "Encountered a script tag" (next-themes #397) unless the script is a data block, so the
 * client copy gets a non-JavaScript type. It never ran there anyway, and next-themes marks the script
 * suppressHydrationWarning, so the different attribute doesn't count as a hydration mismatch.
 */
const SERVER_SCRIPT_PROPS = { "data-cfasync": "false" } as const;
const CLIENT_SCRIPT_PROPS = { "data-cfasync": "false", type: "text/plain" } as const;

function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return typeof value === "string" && (RESOLVED_THEMES as readonly string[]).includes(value);
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  /**
   * The theme when this device has no stored choice (default "system"). In apps/web, pass the account setting:
   * `parseUserSettings(user.settings).appearance.theme`.
   */
  defaultTheme?: ThemePreference | undefined;
  /** The request's CSP nonce, for the pre-paint script. */
  nonce?: string | undefined;
}

/**
 * Sets `<html data-theme="light|dark">` from the stored choice, the default or the OS setting (followed live), with a
 * blocking inline script so the first paint is already themed. Put it high in the root layout, above dynamic segments,
 * so it never re-mounts. The only module that imports next-themes (plan D12), so the library can be swapped out.
 */
export function ThemeProvider({ children, defaultTheme = "system", nonce }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      themes={RESOLVED_THEMES}
      enableSystem
      defaultTheme={defaultTheme}
      enableColorScheme
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      scriptProps={typeof window === "undefined" ? SERVER_SCRIPT_PROPS : CLIENT_SCRIPT_PROPS}
      {...(nonce === undefined ? {} : { nonce })}
    >
      {children}
    </NextThemesProvider>
  );
}

export interface ThemePreferenceState {
  /** The stored or default preference; undefined until hydrated, so the server render shows no choice. */
  preference: ThemePreference | undefined;
  /** What's applied: light or dark ("system" resolved through the OS setting); undefined until hydrated. */
  resolvedTheme: ResolvedTheme | undefined;
  /** Stores a new preference on this device and applies it. */
  setPreference: (preference: ThemePreference) => void;
}

/** The theme preference, for the toggle and for code that needs the resolved theme. */
export function useThemePreference(): ThemePreferenceState {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const isClient = useIsClient();
  return {
    preference: isClient && isThemePreference(theme) ? theme : undefined,
    resolvedTheme: isClient && isResolvedTheme(resolvedTheme) ? resolvedTheme : undefined,
    setPreference: setTheme,
  };
}
