"use client";

import { UserSettingsSchema } from "@finlytics/shared";
import type { UserSettings } from "@finlytics/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api/client";

export const USER_SETTINGS_QUERY_KEY = ["me", "settings"] as const;

/** The account's settings (`GET /v1/me/settings`): complete, with defaults filled in by the api. */
export function useUserSettings() {
  return useQuery({
    queryKey: USER_SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/v1/me/settings", UserSettingsSchema, { signal }),
  });
}

export type AppearancePatch = Partial<UserSettings["appearance"]>;

/**
 * Saves appearance fields to the account (`PATCH /v1/me/settings`), one save at a time (a shared scope, so responses
 * can't land out of order), and puts the api's answer in the settings query. The change is already applied on this
 * device by then: a failure means only the account (and so other devices) didn't get it.
 */
export function useSaveAppearance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...USER_SETTINGS_QUERY_KEY, "appearance"],
    scope: { id: "me-settings" },
    mutationFn: (appearance: AppearancePatch) =>
      apiRequest("/v1/me/settings", UserSettingsSchema, { method: "PATCH", json: { appearance } }),
    onSuccess: (settings) => {
      queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, settings);
    },
  });
}
