"use client";

import { BrokerAccountListSchema, BrokerAccountViewSchema, BrokerAuthRedirectSchema } from "@finlytics/shared";
import type { BrokerAccountView, ConnectDhan, ConnectUpstox, UpdateBrokerAccount } from "@finlytics/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { apiRequest } from "@/lib/api/client";

export const BROKERS_QUERY_KEY = ["brokers"] as const;

/** `GET /v1/brokers`: the user's accounts (shared by the page and the relogin banner; 30 s fresh). */
export function useBrokerAccounts() {
  return useQuery({
    queryKey: BROKERS_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/v1/brokers", BrokerAccountListSchema, { signal }),
  });
}

/** Sends the browser to the broker's login page (an absolute https URL from our api, never user input). */
export function redirectTo(url: string): void {
  window.location.assign(url);
}

/**
 * `POST /v1/brokers/upstox` → `{account, authUrl}` → the Upstox login; the api's callback returns to
 * `/brokers?connected=<id>` (or `?error=`). The PENDING account shows in the list if the user comes back without
 * finishing.
 */
export function useConnectUpstox(navigate: (url: string) => void = redirectTo) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["brokers", "connect", "upstox"],
    mutationFn: (input: ConnectUpstox) =>
      apiRequest("/v1/brokers/upstox", BrokerAuthRedirectSchema, { method: "POST", json: input }),
    onSuccess: async ({ authUrl }) => {
      await queryClient.invalidateQueries({ queryKey: BROKERS_QUERY_KEY });
      navigate(authUrl);
    },
  });
}

/** `POST /v1/brokers/dhan`: validated with the broker (getProfile) before it's saved as ACTIVE. */
export function useConnectDhan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["brokers", "connect", "dhan"],
    mutationFn: (input: ConnectDhan) =>
      apiRequest("/v1/brokers/dhan", BrokerAccountViewSchema, { method: "POST", json: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BROKERS_QUERY_KEY });
    },
  });
}

/** `POST /v1/brokers/:id/relogin` → `{account, authUrl}` (Upstox). Dhan answers 422: paste a new token instead. */
export function useRelogin(navigate: (url: string) => void = redirectTo) {
  return useMutation({
    mutationKey: ["brokers", "relogin"],
    mutationFn: (account: Pick<BrokerAccountView, "id">) =>
      apiRequest(`/v1/brokers/${encodeURIComponent(account.id)}/relogin`, BrokerAuthRedirectSchema, { method: "POST" }),
    onSuccess: ({ authUrl }) => {
      navigate(authUrl);
    },
  });
}

/** `PATCH /v1/brokers/:id` (rename, make default). */
export function useUpdateBrokerAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["brokers", "update"],
    mutationFn: ({ id, ...input }: UpdateBrokerAccount & { id: string }) =>
      apiRequest(`/v1/brokers/${encodeURIComponent(id)}`, z.unknown(), { method: "PATCH", json: input }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: BROKERS_QUERY_KEY });
    },
  });
}

/** `DELETE /v1/brokers/:id`: the encrypted credentials go with it. */
export function useRemoveBrokerAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["brokers", "remove"],
    mutationFn: (account: Pick<BrokerAccountView, "id">) =>
      apiRequest(`/v1/brokers/${encodeURIComponent(account.id)}`, z.unknown(), { method: "DELETE" }),
    onSuccess: (_data, account) => {
      queryClient.setQueryData<BrokerAccountView[]>(BROKERS_QUERY_KEY, (accounts) =>
        accounts?.filter((candidate) => candidate.id !== account.id),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: BROKERS_QUERY_KEY });
    },
  });
}
