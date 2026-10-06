import { UserSettingsSchema } from "@finlytics/shared";
import { describe, expect, expectTypeOf, it } from "vitest";

import { THEME_PREFERENCES, THEME_STORAGE_KEY, isThemePreference } from "../theme";
import type { ResolvedTheme, ThemePreference } from "../theme";

describe("theme names", () => {
  it("covers every appearance.theme value from @finlytics/shared", () => {
    expectTypeOf<(typeof THEME_PREFERENCES)[number]>().toEqualTypeOf<ThemePreference>();
    expectTypeOf<ThemePreference>().toEqualTypeOf<"system" | "light" | "dark">();
    expectTypeOf<ResolvedTheme>().toEqualTypeOf<"light" | "dark">();

    expect([...THEME_PREFERENCES].sort()).toEqual([...UserSettingsSchema.shape.appearance.shape.theme.options].sort());
  });

  it("lists the preferences in the order ThemeToggle shows them", () => {
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
  });

  it("stores the choice under finlytics-theme", () => {
    expect(THEME_STORAGE_KEY).toBe("finlytics-theme");
  });

  it("accepts exactly the three preferences", () => {
    for (const preference of THEME_PREFERENCES) {
      expect(isThemePreference(preference), preference).toBe(true);
    }
    for (const value of ["Dark", "auto", "", " light", null, undefined, 1, {}, ["dark"]]) {
      expect(isThemePreference(value), JSON.stringify(value)).toBe(false);
    }
  });
});
