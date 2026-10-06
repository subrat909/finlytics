"use client";

import { ThemeToggle } from "@finlytics/ui/components/theme-toggle";

import { useSaveTheme } from "@/features/settings/hooks/use-save-theme";

/** The top bar's theme switch: applies on this device at once, then saves to the account. */
export function ThemeControl() {
  const saveTheme = useSaveTheme();
  return (
    <ThemeToggle
      size="sm"
      onThemeChange={(theme) => {
        saveTheme.mutate(theme);
      }}
    />
  );
}
