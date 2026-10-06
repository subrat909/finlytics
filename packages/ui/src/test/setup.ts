/**
 * Setup for the `unit` project (jsdom).
 * - Testing Library: the jest-dom matchers, and unmounting after every test (Testing Library does that by itself only
 *   when the runner exposes globals, which this package doesn't enable).
 * - Browser APIs jsdom lacks: matchMedia (next-themes; see ./match-media.ts) and ResizeObserver (Radix).
 * Accessibility checks go through expectNoAxeViolations() in ./axe.ts.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { installMatchMedia, resetMediaQueries } from "./match-media";

/** jsdom has no layout, so nothing is ever resized: observing is a no-op. */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    // No layout in jsdom.
  }

  unobserve(): void {
    // No layout in jsdom.
  }

  disconnect(): void {
    // No layout in jsdom.
  }
}

installMatchMedia();
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: ResizeObserverStub });

afterEach(() => {
  cleanup();
  resetMediaQueries();
  // What ThemeProvider writes: the stored choice, and data-theme plus the inline color-scheme on <html>.
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});
