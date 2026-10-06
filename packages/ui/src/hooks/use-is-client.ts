"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  // Nothing ever changes after hydration, so there is nothing to subscribe to.
  return () => undefined;
}

/**
 * False during the server render and the hydration render, true afterwards. Render client-only state (a stored theme)
 * behind it, so the server HTML and the first client render match. Built on useSyncExternalStore rather than
 * `useEffect(() => setMounted(true))`, which react-hooks 7 flags (set-state-in-effect) and which renders twice.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
