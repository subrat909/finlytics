"use client";

import { useSyncExternalStore } from "react";

/**
 * One shared 1 s timer for every clock and countdown on the page (the footer's clock and timers, the navbar chip):
 * it runs only while something listens, and each listener re-renders once per second.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    for (const notify of listeners) notify();
  }, 1_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function currentSecond(): number {
  return Math.floor(Date.now() / 1_000) * 1_000;
}

function serverSnapshot(): null {
  return null;
}

/** The current second (epoch ms, whole seconds), or null during SSR and hydration. */
export function useSecond(): number | null {
  return useSyncExternalStore(subscribe, currentSecond, serverSnapshot);
}
