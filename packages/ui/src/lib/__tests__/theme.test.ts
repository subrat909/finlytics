import { UserSettingsSchema } from "@finlytics/shared";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DENSITY_ATTRIBUTE,
  DENSITY_PREFERENCES,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  isDensityPreference,
  isThemePreference,
} from "../theme";
import type { DensityPreference, ResolvedTheme, ThemePreference } from "../theme";

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

describe("density names", () => {
  it("covers every appearance.density value from @finlytics/shared, comfortable first", () => {
    expectTypeOf<(typeof DENSITY_PREFERENCES)[number]>().toEqualTypeOf<DensityPreference>();
    expectTypeOf<DensityPreference>().toEqualTypeOf<"comfortable" | "compact">();

    expect(DENSITY_PREFERENCES).toEqual(["comfortable", "compact"]);
    expect([...DENSITY_PREFERENCES].sort()).toEqual(
      [...UserSettingsSchema.shape.appearance.shape.density.options].sort(),
    );
  });

  it("applies through data-density, the attribute theme.css reads", () => {
    expect(DENSITY_ATTRIBUTE).toBe("data-density");
  });

  it("accepts exactly the two densities", () => {
    for (const density of DENSITY_PREFERENCES) {
      expect(isDensityPreference(density), density).toBe(true);
    }
    for (const value of ["Compact", "cozy", "", null, undefined, 0, {}, ["compact"]]) {
      expect(isDensityPreference(value), JSON.stringify(value)).toBe(false);
    }
  });
});
