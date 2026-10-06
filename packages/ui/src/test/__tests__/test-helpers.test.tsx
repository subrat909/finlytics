import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../axe";
import { setMediaQuery } from "../match-media";

const DARK = "(prefers-color-scheme: dark)";

describe("jsdom setup", () => {
  it("provides matchMedia and ResizeObserver both as window properties and as globals", () => {
    expect(typeof window.matchMedia).toBe("function");
    expect(typeof globalThis.matchMedia).toBe("function");
    expect(typeof window.ResizeObserver).toBe("function");
    expect(typeof globalThis.ResizeObserver).toBe("function");
  });
});

describe("expectNoAxeViolations", () => {
  it("passes accessible markup", async () => {
    const { container } = render(
      <label>
        Quantity <input type="number" />
      </label>,
    );

    await expectNoAxeViolations(container);
  });

  it("fails with axe's report when a control has no accessible name", async () => {
    const { container } = render(
      <button type="button">
        <svg aria-hidden="true" />
      </button>,
    );

    await expect(expectNoAxeViolations(container)).rejects.toThrow(/button-name/);
  });
});

describe("matchMedia stub", () => {
  it("matches nothing until a test sets a query", () => {
    expect(window.matchMedia(DARK).matches).toBe(false);

    setMediaQuery(DARK, true);

    expect(window.matchMedia(DARK).matches).toBe(true);
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
  });

  it("notifies change listeners, including the deprecated addListener API", () => {
    const list = window.matchMedia(DARK);
    const seen: boolean[] = [];
    list.addEventListener("change", (event) => seen.push(event.matches));
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- next-themes 0.4 subscribes through this API.
    list.addListener((event) => seen.push(event.matches));

    setMediaQuery(DARK, true);

    expect(seen).toEqual([true, true]);
  });

  it("starts every test with nothing matching", () => {
    expect(window.matchMedia(DARK).matches).toBe(false);
  });
});
