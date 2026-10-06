/**
 * Assertions shared by story play functions. They run in a real browser: in Storybook, in the `storybook*` Vitest
 * projects and in the visual suite.
 */
import { expect, waitFor } from "storybook/test";

import { parseHex, readToken } from "../foundations/contrast";

/** The channels of a computed colour or of a hex token (#rrggbb, or #rgb from the minified build), for comparing. */
export function colorChannels(color: string): number[] {
  const hex = parseHex(color);
  if (hex) return [...hex];
  return (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
}

/**
 * The focus indicator (plan D7) on a focused element: a 2px solid outline in --ring, 2px outside, and no shadow.
 * getComputedStyle() is live, so the properties are read together, and the check retries briefly: after a scripted
 * (userEvent) focus, Chrome can re-evaluate :focus-visible between two reads.
 */
export async function expectFocusOutline(element: Element): Promise<void> {
  await expect(element).toHaveFocus();
  const ring = colorChannels(readToken("ring"));
  await waitFor(async () => {
    const { outlineStyle, outlineWidth, outlineOffset, outlineColor, boxShadow } = getComputedStyle(element);
    await expect({
      outlineStyle,
      outlineWidth,
      outlineOffset,
      outlineColor: colorChannels(outlineColor),
      boxShadow,
    }).toEqual({
      outlineStyle: "solid",
      outlineWidth: "2px",
      outlineOffset: "2px",
      outlineColor: ring,
      boxShadow: "none",
    });
  });
}

/** The page doesn't scroll sideways at the current viewport (360 px in the `storybook-360` project). */
export async function expectNoHorizontalScroll(): Promise<void> {
  const page = document.documentElement;
  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
}
