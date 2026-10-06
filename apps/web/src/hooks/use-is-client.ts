import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => undefined;
}

/** false during the server render and hydration, true afterwards: render client-only state without a mismatch. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
