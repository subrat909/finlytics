"use client";

import { UserSettingsSchema } from "@finlytics/shared";
import type { ThemePreference } from "@finlytics/ui/lib/theme";
import { useMutation } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api/client";
import { announce } from "@/stores/announcer.store";

/**
 * Saves the theme to the account (`PATCH /v1/me/settings`, plan W11), so a new device starts with it. The device's own
 * choice is already applied by then; a failure only means other devices won't follow, so it's announced, not modal.
 */
export function useSaveTheme() {
  return useMutation({
    mutationKey: ["me", "settings", "theme"],
    mutationFn: (theme: ThemePreference) =>
      apiRequest("/v1/me/settings", UserSettingsSchema, { method: "PATCH", json: { appearance: { theme } } }),
    onError: () => {
      announce("Your theme applies on this device, but it couldn't be saved to your account.");
    },
  });
}
