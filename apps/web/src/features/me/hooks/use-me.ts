"use client";

import { MeSchema } from "@finlytics/shared";
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api/client";

export const ME_QUERY_KEY = ["me"] as const;

/** The signed-in user from the api (`GET /v1/me`): proves the session cookie reaches the api through `/v1`. */
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/v1/me", MeSchema, { signal }),
  });
}
