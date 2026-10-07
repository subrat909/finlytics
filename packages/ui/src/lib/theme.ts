import type { UserSettings } from "@finlytics/shared";

/*
 * Theme names and the storage key, without a "use client" directive, so Server Components can read the values (a
 * Server Component that imports a constant from a "use client" module gets a client reference, not the value).
 * ThemeProvider and ThemeToggle import from here; components/theme-provider re-exports these names for client code.
 */

/** A user's theme setting: `appearance.theme` in @finlytics/shared, so the API and the UI can't drift apart. */
export type ThemePreference = UserSettings["appearance"]["theme"];

/** What a preference resolves to: "system" follows the OS setting. */
export type ResolvedTheme = Exclude<ThemePreference, "system">;

/** Every preference, in the order ThemeToggle shows them. A type test keeps it equal to ThemePreference. */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const satisfies readonly ThemePreference[];

/** Where this device's choice is stored (localStorage). */
export const THEME_STORAGE_KEY = "finlytics-theme";

/** Narrows an unknown value (a stored string, a form value) to a ThemePreference. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** A user's density setting: `appearance.density` in @finlytics/shared. */
export type DensityPreference = UserSettings["appearance"]["density"];

/** Every density, in the order the settings page shows them. A type test keeps it equal to DensityPreference. */
export const DENSITY_PREFERENCES = ["comfortable", "compact"] as const satisfies readonly DensityPreference[];

/** The attribute on <html> that applies the density (theme.css tightens the spacing scale for `compact`). */
export const DENSITY_ATTRIBUTE = "data-density";

/** Narrows an unknown value (a cookie, a form value) to a DensityPreference. */
export function isDensityPreference(value: unknown): value is DensityPreference {
  return typeof value === "string" && (DENSITY_PREFERENCES as readonly string[]).includes(value);
}
