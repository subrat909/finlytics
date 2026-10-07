"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `value`, changing at most once per `intervalMs` (the latest value wins, trailing). For live regions: a P&L that ticks
 * ten times a second is announced every few seconds instead (frontend.md: aria-live throttled). The timer is cleared
 * on every change and on unmount.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const lastAt = useRef(0);

  useEffect(() => {
    if (Object.is(value, shownRef.current)) return;
    const wait = Math.max(0, lastAt.current + intervalMs - Date.now());
    const timer = setTimeout(() => {
      lastAt.current = Date.now();
      shownRef.current = value;
      setShown(value);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [value, intervalMs]);

  return shown;
}
