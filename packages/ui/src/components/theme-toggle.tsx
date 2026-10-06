"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type * as React from "react";

import { THEME_PREFERENCES } from "../lib/theme";
import type { ThemePreference } from "../lib/theme";

import { SegmentedControl } from "./segmented-control";
import type { SegmentedOption } from "./segmented-control";
import { useThemePreference } from "./theme-provider";

const LABELS: Readonly<Record<ThemePreference, string>> = { system: "System", light: "Light", dark: "Dark" };
const ICONS: Readonly<Record<ThemePreference, React.ReactNode>> = {
  system: <Monitor />,
  light: <Sun />,
  dark: <Moon />,
};

const OPTIONS: readonly SegmentedOption<ThemePreference>[] = THEME_PREFERENCES.map((value) => ({
  value,
  label: LABELS[value],
  icon: ICONS[value],
}));

export interface ThemeToggleProps extends Omit<React.ComponentProps<"div">, "onChange" | "defaultValue" | "dir"> {
  /** Called with the new preference after it's applied. apps/web saves it: PATCH /v1/me/settings. */
  onThemeChange?: ((preference: ThemePreference) => void) | undefined;
  /** `sm`: icons only, with screen-reader labels. `md` (default): icon and text (the settings page). */
  size?: "sm" | "md" | undefined;
  /** The radio group's accessible name (default "Theme"). Pass `aria-labelledby` instead to use a visible label. */
  label?: string | undefined;
}

/**
 * System, Light or Dark: a SegmentedControl (a radio group; every arrow key moves and selects, and the checked option
 * stands out in forced-colours mode too). No option is checked until hydration, so the server HTML matches whatever
 * this device stored. Must be inside ThemeProvider. Reports changes through `onThemeChange` only: the UI package never
 * calls the API.
 */
export function ThemeToggle({ onThemeChange, size = "md", label = "Theme", ...props }: ThemeToggleProps) {
  const { preference, setPreference } = useThemePreference();

  return (
    <SegmentedControl
      data-slot="theme-toggle"
      options={OPTIONS}
      value={preference}
      size={size}
      label={props["aria-labelledby"] === undefined ? label : undefined}
      onValueChange={(value) => {
        setPreference(value);
        onThemeChange?.(value);
      }}
      {...props}
    />
  );
}
