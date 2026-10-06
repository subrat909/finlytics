import { describe, expect, it } from "vitest";

import { blend, contrastRatio, parseHex, relativeLuminance } from "./wcag";

const WHITE = parseHex("#ffffff");
const BLACK = parseHex("#000000");

describe("WCAG contrast helper", () => {
  it("computes 21:1 for black on white", () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(21);
    expect(contrastRatio(WHITE, BLACK)).toBe(21);
  });

  it("computes 4.48:1 for #777777 on white", () => {
    expect(contrastRatio(parseHex("#777777"), WHITE)).toBeCloseTo(4.48, 2);
  });

  it("computes 1:1 for a colour on itself", () => {
    expect(contrastRatio(parseHex("#4f46e5"), parseHex("#4f46e5"))).toBe(1);
  });

  it("blends an alpha colour over its surface before measuring", () => {
    const halfBlackOnWhite = blend(BLACK, 0.5, WHITE);

    expect(halfBlackOnWhite).toEqual([127.5, 127.5, 127.5]);
    expect(contrastRatio(WHITE, halfBlackOnWhite)).toBeCloseTo(3.98, 2);
    expect(blend(BLACK, 1, WHITE)).toEqual(BLACK);
    expect(blend(BLACK, 0, WHITE)).toEqual(WHITE);
  });

  it("rejects malformed colours and alphas", () => {
    expect(() => parseHex("#fff")).toThrow(/6-digit/);
    expect(() => parseHex("rgb(0 0 0)")).toThrow(/6-digit/);
    expect(() => blend(BLACK, 1.5, WHITE)).toThrow(RangeError);
  });

  it("uses the sRGB transfer function, including its linear segment", () => {
    expect(relativeLuminance(WHITE)).toBe(1);
    expect(relativeLuminance(BLACK)).toBe(0);
    // 10/255 = 0.0392 is under the 0.04045 knee: linear, 0.0392 / 12.92.
    expect(relativeLuminance([10, 10, 10])).toBeCloseTo(10 / 255 / 12.92, 10);
  });
});
