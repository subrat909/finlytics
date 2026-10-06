/**
 * Setup for the `dom` project (jsdom): jest-dom matchers, cleanup after every test, and the browser APIs jsdom lacks
 * (matchMedia for next-themes and the mobile sheet, ResizeObserver and pointer capture for Radix).
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    // jsdom has no layout.
  }

  unobserve(): void {
    // jsdom has no layout.
  }

  disconnect(): void {
    // jsdom has no layout.
  }
}

function matchMedia(query: string): MediaQueryList {
  const list = new EventTarget() as MediaQueryList;
  return Object.assign(list, {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });
}

Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: ResizeObserverStub });
// Radix menus and cmdk call these; jsdom doesn't implement them.
const ELEMENT_STUBS: Record<string, () => unknown> = {
  hasPointerCapture: () => false,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
};
for (const [name, value] of Object.entries(ELEMENT_STUBS)) {
  if (!(name in Element.prototype)) Object.defineProperty(Element.prototype, name, { configurable: true, value });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.cookie.split(";").forEach((cookie) => {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});
