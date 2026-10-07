"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type * as React from "react";

import { isApiError, shouldRetry } from "@/lib/api/client";

/** Where a 401 sends the user: /login, then back to this page. */
export function loginPathFor(location: Pick<Location, "pathname" | "search">): Route {
  const callbackUrl = `${location.pathname}${location.search}`;
  return `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` as Route;
}

/**
 * A 401 from the api means the session is gone: go to /login (api plan §10.1). A 503 or 429 never signs out; the
 * retry policy handles it.
 */
export function makeQueryClient(navigate: (path: Route) => void): QueryClient {
  const signOutOnUnauthenticated = (error: unknown) => {
    if (isApiError(error) && error.unauthenticated) navigate(loginPathFor(window.location));
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: signOutOnUnauthenticated }),
    mutationCache: new MutationCache({ onError: signOutOnUnauthenticated }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/** Client-side providers for the whole app (one QueryClient per browser tab). */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(() =>
    makeQueryClient((path) => {
      router.replace(path);
    }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
