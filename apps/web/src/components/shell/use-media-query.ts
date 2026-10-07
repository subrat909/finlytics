"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a media query matches, kept in step with the viewport. False on the server and during hydration (the server
 * can't know the width), so render the markup either way and use this only to decide work (subscribing to live prices
 * the user can see). The listener is removed when the component unmounts.
 */
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
