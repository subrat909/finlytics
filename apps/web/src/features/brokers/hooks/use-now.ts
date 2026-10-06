"use client";

import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;
let current = Date.now();

function subscribe(onChange: () => void): () => void {
  current = Date.now();
  const timer = setInterval(() => {
    current = Date.now();
    onChange();
  }, MINUTE_MS);
  return () => {
    clearInterval(timer);
  };
}

function getSnapshot(): number {
  return current;
}

/** No clock on the server: callers show absolute dates until the browser takes over (no hydration mismatch). */
function getServerSnapshot(): number | null {
  return null;
}

/** The current time, refreshed every minute (token expiry countdowns); null during the server render. */
export function useNow(): number | null {
  return useSyncExternalStore<number | null>(subscribe, getSnapshot, getServerSnapshot);
}
