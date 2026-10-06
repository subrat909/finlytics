/**
 * Density's SSR hint (like the sidebar's): the account's `appearance.density` is the setting, and this cookie mirrors
 * it on the device, so the root layout server-renders `<html data-density>` and the first paint has the right spacing.
 * A preference, not a secret. No directive: the root layout (server) and the settings page (client) both use it.
 */
import { isDensityPreference } from "@finlytics/ui/lib/theme";
import type { DensityPreference } from "@finlytics/ui/lib/theme";

export const DENSITY_COOKIE = "finlytics-density";

/** The density a cookie value stands for; anything unknown is the default, comfortable. */
export function densityFromCookie(value: string | undefined): DensityPreference {
  return isDensityPreference(value) ? value : "comfortable";
}

/** Writes the hint cookie (readable by scripts, sent to this origin only, for a year). */
export function writeDensityCookie(density: DensityPreference): void {
  if (typeof document === "undefined") return;
  document.cookie = `${DENSITY_COOKIE}=${density}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
