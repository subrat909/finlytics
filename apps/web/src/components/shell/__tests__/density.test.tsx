import { describe, expect, it } from "vitest";

import { DENSITY_COOKIE, densityFromCookie, writeDensityCookie } from "../density";

describe("density hint cookie", () => {
  it("reads a known density and falls back to comfortable for anything else", () => {
    expect(densityFromCookie("compact")).toBe("compact");
    expect(densityFromCookie("comfortable")).toBe("comfortable");
    for (const value of [undefined, "", "Compact", "cozy"]) {
      expect(densityFromCookie(value), String(value)).toBe("comfortable");
    }
  });

  it("writes a year-long, site-wide, SameSite=Lax hint", () => {
    writeDensityCookie("compact");

    expect(DENSITY_COOKIE).toBe("finlytics-density");
    expect(document.cookie).toContain("finlytics-density=compact");
  });
});
