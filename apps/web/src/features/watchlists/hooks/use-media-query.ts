"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** The breakpoint where the watchlist shows its detail panel beside the list (Tailwind `lg`). */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Whether `query` matches; false during the server render and hydration, then live (resizes included). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** `value`, `delay` ms after it last changed (the first value at once): keyboard browsing doesn't refetch per row. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return debounced;
}
