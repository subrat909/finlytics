"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import type * as React from "react";

import { THEME_PREFERENCES, isThemePreference } from "../lib/theme";
import type { ThemePreference } from "../lib/theme";
import { cn } from "../lib/utils";

import { useThemePreference } from "./theme-provider";

const OPTIONS: Readonly<Record<ThemePreference, { label: string; Icon: LucideIcon }>> = {
  system: { label: "System", Icon: Monitor },
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
};

export interface ThemeToggleProps extends Omit<React.ComponentProps<"div">, "onChange" | "defaultValue" | "dir"> {
  /** Called with the new preference after it's applied. apps/web saves it: PATCH /v1/me/settings. */
  onThemeChange?: ((preference: ThemePreference) => void) | undefined;
  /** `sm`: icons only, with screen-reader labels (the top bar). `md` (default): icon and text (settings). */
  size?: "sm" | "md" | undefined;
  /** The radio group's accessible name (default "Theme"). */
  label?: string | undefined;
}

/**
 * System, Light or Dark, as a radio group: every arrow key (Left and Up back, Right and Down forward, as in the APG
 * radio group pattern) moves and selects, and the checked option is filled primary on the surface-2 track. In
 * forced-colours mode (Windows contrast themes), where the fill would be replaced, the checked option is drawn in the
 * system Highlight colours instead. No option is checked until hydration, so the server HTML matches whatever this
 * device stored. Must be inside ThemeProvider. Reports changes through `onThemeChange` only: the UI package never
 * calls the API.
 */
export function ThemeToggle({ onThemeChange, size = "md", label = "Theme", className, ...props }: ThemeToggleProps) {
  const { preference, setPreference } = useThemePreference();

  return (
    <RadioGroup.Root
      data-slot="theme-toggle"
      aria-label={label}
      value={preference ?? ""}
      onValueChange={(value) => {
        if (isThemePreference(value)) {
          setPreference(value);
          onThemeChange?.(value);
        }
      }}
      className={cn("inline-flex items-center gap-1 rounded-xl bg-surface-2 p-1", className)}
      {...props}
    >
      {THEME_PREFERENCES.map((value) => {
        const { label: optionLabel, Icon } = OPTIONS[value];
        return (
          <RadioGroup.Item
            key={value}
            value={value}
            data-slot="theme-toggle-option"
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-medium text-fg-muted",
              "transition-[color,background-color] hover:bg-surface-3 hover:text-fg",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
              "data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg",
              // Forced colours replace the primary fill with the page's Canvas, which would hide the checked state. The
              // checked option opts out of the forced palette and paints itself in the user's system colours. Opting out
              // also stops the outline being forced, so it's set to CanvasText, what the browser forces on the others.
              "forced-colors:data-[state=checked]:forced-color-adjust-none",
              "forced-colors:data-[state=checked]:bg-[Highlight] forced-colors:data-[state=checked]:text-[HighlightText]",
              "forced-colors:data-[state=checked]:outline-[CanvasText]",
              "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
              size === "sm" ? "size-8" : "h-8 px-3",
            )}
          >
            <Icon />
            <span className={size === "sm" ? "sr-only" : undefined}>{optionLabel}</span>
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
