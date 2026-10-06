import { describe, expect, expectTypeOf, it } from "vitest";

import { deepFreeze } from "../internal/deep-freeze";
import {
  DEFAULT_USER_SETTINGS,
  mergeUserSettings,
  NOTIFICATION_CATEGORIES,
  NotificationCategorySchema,
  parseUserSettings,
  parseUserSettingsWithIssues,
  UserSettingsPatchSchema,
  UserSettingsSchema,
} from "../schemas/user-settings";
import type { UserSettings, UserSettingsPatch } from "../schemas/user-settings";

/** The defaults of plan §5, written out so a change to them is a deliberate test change. */
const PLAN_DEFAULTS: UserSettings = {
  appearance: { theme: "system", density: "comfortable" },
  trading: {
    defaultOrderMode: "PAPER",
    defaultProduct: "INTRADAY",
    defaultOrderType: "LIMIT",
    defaultValidity: "DAY",
    defaultQtyLots: 1,
    confirmBeforePlace: true,
  },
  notifications: {
    sound: true,
    categories: {
      order: { inApp: true, push: true, email: false, telegram: false },
      alert: { inApp: true, push: true, email: false, telegram: false },
      agent: { inApp: true, push: false, email: false, telegram: false },
      broker: { inApp: true, push: true, email: true, telegram: false },
      system: { inApp: true, push: false, email: true, telegram: false },
    },
  },
};

/** Settings a user has customised everywhere, as the API would have stored them. */
function customised(): UserSettings {
  return {
    appearance: { theme: "dark", density: "compact" },
    trading: {
      defaultOrderMode: "LIVE",
      defaultProduct: "MARGIN",
      defaultOrderType: "MARKET",
      defaultValidity: "IOC",
      defaultQtyLots: 4,
      confirmBeforePlace: false,
    },
    notifications: {
      sound: false,
      categories: {
        order: { inApp: false, push: false, email: true, telegram: true },
        alert: { inApp: true, push: false, email: true, telegram: true },
        agent: { inApp: false, push: true, email: true, telegram: true },
        broker: { inApp: true, push: false, email: false, telegram: true },
        system: { inApp: true, push: true, email: false, telegram: true },
      },
    },
  };
}

/** Every object in a settings tree, with its path. */
function objectsIn(value: unknown, path = "(root)"): [string, object][] {
  if (typeof value !== "object" || value === null) return [];
  return [
    [path, value],
    ...Object.entries(value).flatMap(([key, child]) => objectsIn(child, path === "(root)" ? key : `${path}.${key}`)),
  ];
}

describe("parseUserSettings", () => {
  it("returns full defaults for an empty object", () => {
    expect(parseUserSettings({})).toEqual(PLAN_DEFAULTS);
    expect(DEFAULT_USER_SETTINGS).toEqual(PLAN_DEFAULTS);
    expect(UserSettingsSchema.parse(DEFAULT_USER_SETTINGS)).toEqual(PLAN_DEFAULTS);
    expect(parseUserSettingsWithIssues({})).toEqual({ settings: PLAN_DEFAULTS, issues: [] });
  });

  it("fills in missing sections and fields from their defaults", () => {
    const settings = parseUserSettings({
      appearance: { theme: "dark" },
      notifications: { categories: { order: { push: false } } },
    });

    expect(settings).toEqual({
      ...PLAN_DEFAULTS,
      appearance: { theme: "dark", density: "comfortable" },
      notifications: {
        ...PLAN_DEFAULTS.notifications,
        categories: {
          ...PLAN_DEFAULTS.notifications.categories,
          order: { inApp: true, push: false, email: false, telegram: false },
        },
      },
    });
  });

  it("keeps every valid stored value", () => {
    expect(parseUserSettings(customised())).toEqual(customised());
    expect(parseUserSettingsWithIssues(customised()).issues).toEqual([]);
  });

  it("falls back per field when a stored value is invalid", () => {
    const stored = customised() as unknown as Record<string, Record<string, unknown>>;
    stored.appearance = { theme: "dark", density: "tiny" };
    stored.trading = { ...stored.trading, defaultProduct: "CO", defaultOrderType: "SL", defaultQtyLots: 101 };
    stored.notifications = {
      sound: "yes",
      categories: { ...customised().notifications.categories, order: { inApp: false, push: 1, email: true } },
    };

    expect(parseUserSettings(stored)).toEqual({
      appearance: { theme: "dark", density: "comfortable" },
      trading: { ...customised().trading, defaultProduct: "INTRADAY", defaultOrderType: "LIMIT", defaultQtyLots: 1 },
      notifications: {
        sound: true,
        categories: {
          ...customised().notifications.categories,
          order: { inApp: false, push: true, email: true, telegram: false },
        },
      },
    });
  });

  it.each<[string, unknown]>([
    ["0", 0],
    ["101", 101],
    ["2.5", 2.5],
    ['"5"', "5"],
    ["null", null],
    ["NaN", Number.NaN],
  ])("falls back to 1 lot for a stored defaultQtyLots of %s", (_label, defaultQtyLots) => {
    expect(parseUserSettings({ trading: { defaultQtyLots } }).trading.defaultQtyLots).toBe(1);
  });

  it("falls back to a section's defaults when the section is not an object", () => {
    for (const appearance of [null, "dark", 42, [], [{ theme: "dark" }], true]) {
      const settings = parseUserSettings({ appearance, trading: customised().trading });

      expect(settings.appearance, JSON.stringify(appearance)).toEqual(PLAN_DEFAULTS.appearance);
      expect(settings.trading).toEqual(customised().trading);
    }
    expect(parseUserSettings({ notifications: { categories: "all" } }).notifications.categories).toEqual(
      PLAN_DEFAULTS.notifications.categories,
    );
    const { categories } = parseUserSettings({
      notifications: { categories: { agent: false, system: null } },
    }).notifications;
    expect(categories.agent).toEqual(PLAN_DEFAULTS.notifications.categories.agent);
    expect(categories.system).toEqual(PLAN_DEFAULTS.notifications.categories.system);
  });

  it("never throws: anything that is not an object reads as the defaults", () => {
    const values = [null, undefined, [], [customised()], "", "{}", 42, true, Number.NaN, Symbol("settings"), 1n];
    for (const [index, raw] of values.entries()) {
      expect(parseUserSettings(raw), `value ${String(index)} (${typeof raw})`).toEqual(PLAN_DEFAULTS);
    }
    expect(parseUserSettings(Object.create(null))).toEqual(PLAN_DEFAULTS);
    expect(parseUserSettings(new Date(0))).toEqual(PLAN_DEFAULTS);
  });

  it("drops unknown stored keys on read", () => {
    const stored = {
      ...customised(),
      legacy: { riskLimits: { maxLossDay: "5000" } },
      appearance: { ...customised().appearance, fontSize: 14 },
      notifications: {
        ...customised().notifications,
        categories: {
          ...customised().notifications.categories,
          marketing: { inApp: true },
          order: { ...customised().notifications.categories.order, sms: true },
        },
      },
    };

    const { settings, issues } = parseUserSettingsWithIssues(stored);

    expect(settings).toEqual(customised());
    expect(settings).not.toHaveProperty("legacy");
    expect(settings.appearance).not.toHaveProperty("fontSize");
    expect(settings.notifications.categories).not.toHaveProperty("marketing");
    expect([...issues].sort()).toEqual([
      '(root): Unrecognized key: "legacy"',
      'appearance: Unrecognized key: "fontSize"',
      'notifications.categories.order: Unrecognized key: "sms"',
      'notifications.categories: Unrecognized key: "marketing"',
    ]);
  });

  it("drops a JSON __proto__ key without touching any prototype", () => {
    const stored: unknown = JSON.parse('{"__proto__": {"polluted": true}, "appearance": {"theme": "dark"}}');

    const { settings, issues } = parseUserSettingsWithIssues(stored);

    expect(settings.appearance.theme).toBe("dark");
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(issues).toEqual(['(root): Unrecognized key: "__proto__"']);
  });
});

describe("parseUserSettingsWithIssues", () => {
  it("lists each repaired value with a readable path", () => {
    const { settings, issues } = parseUserSettingsWithIssues({
      appearance: { theme: "neon" },
      trading: "manual",
      notifications: { sound: "loud", categories: { broker: { inApp: false } } },
    });

    expect(settings).toEqual(PLAN_DEFAULTS);
    expect(issues).toEqual([
      'appearance.theme: Invalid option: expected one of "system"|"light"|"dark"',
      "trading: Invalid input: expected object, received string",
      "notifications.sound: Invalid input: expected boolean, received string",
      "notifications.categories.broker.inApp: Invalid input: expected true",
    ]);
  });

  it("reports a stored value that is not an object at the root", () => {
    expect(parseUserSettingsWithIssues(null).issues).toEqual(["(root): Invalid input: expected object, received null"]);
    expect(parseUserSettingsWithIssues([]).issues).toEqual(["(root): Invalid input: expected object, received array"]);
  });

  it("lists at most 5 unknown keys per object, truncated, so corrupted data can't flood the logs", () => {
    const stored: Record<string, number> = { [`k${"x".repeat(100)}`]: 0 };
    for (let index = 0; index < 999; index += 1) stored[`k${String(index)}`] = index;

    const { settings, issues } = parseUserSettingsWithIssues(stored);

    expect(settings).toEqual(PLAN_DEFAULTS);
    expect(issues).toEqual([`(root): Unrecognized keys: "k${"x".repeat(39)}…", "k0", "k1", "k2", "k3" and 995 more`]);
  });
});

describe("DEFAULT_USER_SETTINGS", () => {
  it("returns independent copies of the defaults", () => {
    const first = parseUserSettings({});
    const second = parseUserSettings({});
    const fromCatch = [parseUserSettings(null), parseUserSettings({ appearance: "x", notifications: [] })];

    for (const settings of [first, ...fromCatch]) {
      const objects = objectsIn(settings);
      const others = new Set([...objectsIn(second), ...objectsIn(DEFAULT_USER_SETTINGS)].map(([, object]) => object));
      expect(objects).toHaveLength(10);
      for (const [path, object] of objects) {
        expect(others.has(object), path).toBe(false);
        expect(Object.isFrozen(object), path).toBe(false);
      }
    }

    first.appearance.theme = "dark";
    first.notifications.categories.order.push = false;
    expect(second).toEqual(PLAN_DEFAULTS);
    expect(parseUserSettings({})).toEqual(PLAN_DEFAULTS);
    expect(DEFAULT_USER_SETTINGS).toEqual(PLAN_DEFAULTS);
  });

  it("is frozen at every depth", () => {
    for (const [path, object] of objectsIn(DEFAULT_USER_SETTINGS)) expect(Object.isFrozen(object), path).toBe(true);
    expect(() => {
      (DEFAULT_USER_SETTINGS.notifications.categories.order as { push: boolean }).push = false;
    }).toThrow(TypeError);
    expectTypeOf(DEFAULT_USER_SETTINGS.appearance).toEqualTypeOf<{
      readonly theme: "system" | "light" | "dark";
      readonly density: "comfortable" | "compact";
    }>();
  });
});

describe("UserSettingsSchema", () => {
  it("is the strict, complete response shape", () => {
    expect(UserSettingsSchema.parse(customised())).toEqual(customised());
    expect(UserSettingsSchema.safeParse({ ...customised(), trading: undefined }).success).toBe(false);
    expect(UserSettingsSchema.safeParse({ ...customised(), extra: 1 }).success).toBe(false);
    expect(
      UserSettingsSchema.safeParse({ ...customised(), appearance: { theme: "dark", density: "compact", x: 1 } })
        .success,
    ).toBe(false);
  });

  it("names its notification categories after NOTIFICATION_CATEGORIES", () => {
    expect(Object.keys(UserSettingsSchema.shape.notifications.shape.categories.shape)).toEqual([
      ...NOTIFICATION_CATEGORIES,
    ]);
    expect(NotificationCategorySchema.options).toEqual(["order", "alert", "agent", "broker", "system"]);
    expect(Object.isFrozen(NOTIFICATION_CATEGORIES)).toBe(true);
  });

  it("limits order defaults to the subsets of the Prisma enums that make sense as defaults", () => {
    const trading = UserSettingsSchema.shape.trading.shape;

    expect(trading.defaultProduct.options).toEqual(["INTRADAY", "DELIVERY", "MARGIN"]);
    expect(trading.defaultOrderType.options).toEqual(["MARKET", "LIMIT"]);
    expect(trading.defaultValidity.options).toEqual(["DAY", "IOC"]);
    expect(trading.defaultOrderMode.options).toEqual(["PAPER", "LIVE"]);
  });

  it("holds no risk limits, auto-trade, kill switch or default broker", () => {
    const paths = objectsIn(DEFAULT_USER_SETTINGS).flatMap(([path, object]) =>
      Object.keys(object).map((key) => `${path}.${key}`),
    );

    expect(paths.filter((path) => /risk|limit|auto|kill|maxLoss|brokerAccount|defaultBroker/i.test(path))).toEqual([]);
  });
});

describe("UserSettingsPatchSchema", () => {
  it("accepts any subset of fields at any depth", () => {
    for (const patch of [
      {},
      { appearance: {} },
      { appearance: { theme: "light" } },
      { trading: { defaultQtyLots: 100 } },
      { notifications: { categories: { order: { push: false } } } },
      { notifications: { categories: { broker: { inApp: true, telegram: true } } } },
      customised(),
    ]) {
      expect(UserSettingsPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(true);
    }
  });

  it("rejects unknown keys in a patch", () => {
    const attempts: [unknown, (string | number)[]][] = [
      [{ legacy: true }, []],
      [{ appearance: { fontSize: 14 } }, ["appearance"]],
      [{ notifications: { categories: { marketing: { push: true } } } }, ["notifications", "categories"]],
      [{ notifications: { categories: { order: { sms: true } } } }, ["notifications", "categories", "order"]],
      [{ riskLimits: { maxLossDay: "1000" } }, []],
      [JSON.parse('{"__proto__": {"polluted": true}}'), []],
    ];

    for (const [patch, path] of attempts) {
      const result = UserSettingsPatchSchema.safeParse(patch);

      expect(result.success, JSON.stringify(patch)).toBe(false);
      expect(result.error?.issues, JSON.stringify(patch)).toMatchObject([{ code: "unrecognized_keys", path }]);
    }
  });

  it("rejects null, invalid values and wrong shapes", () => {
    for (const patch of [
      null,
      [],
      { appearance: null },
      { appearance: { theme: "neon" } },
      { trading: { defaultQtyLots: 0 } },
      { trading: { defaultQtyLots: 1.5 } },
      { trading: { defaultProduct: "BO" } },
      { notifications: { sound: "on" } },
      { notifications: { categories: [] } },
    ]) {
      expect(UserSettingsPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("mergeUserSettings", () => {
  it("merges a section patch without touching other sections", () => {
    const current = deepFreeze(customised());
    const patch = deepFreeze({ appearance: { theme: "light" } } satisfies UserSettingsPatch);

    const merged = mergeUserSettings(current, patch);

    expect(merged).toEqual({ ...customised(), appearance: { theme: "light", density: "compact" } });
    // Frozen inputs: a merge that mutated either would have thrown. Both are unchanged.
    expect(current).toEqual(customised());
    expect(patch).toEqual({ appearance: { theme: "light" } });
  });

  it("changes one nested field and nothing else", () => {
    const merged = mergeUserSettings(customised(), { notifications: { categories: { order: { push: true } } } });

    expect(merged).toEqual({
      ...customised(),
      notifications: {
        ...customised().notifications,
        categories: {
          ...customised().notifications.categories,
          order: { ...customised().notifications.categories.order, push: true },
        },
      },
    });
  });

  it("returns new objects that share nothing with its inputs", () => {
    const current = customised();
    const patch = { appearance: { theme: "light" as const } };

    const merged = mergeUserSettings(current, patch);

    const inputs = new Set([...objectsIn(current), ...objectsIn(patch)].map(([, object]) => object));
    for (const [path, object] of objectsIn(merged)) expect(inputs.has(object), path).toBe(false);
    expect(mergeUserSettings(DEFAULT_USER_SETTINGS, {})).toEqual(PLAN_DEFAULTS);
    expect(Object.isFrozen(mergeUserSettings(DEFAULT_USER_SETTINGS, {}).appearance)).toBe(false);
  });

  it("treats undefined in a patch as unchanged", () => {
    expect(mergeUserSettings(customised(), { appearance: { theme: undefined }, trading: undefined })).toEqual(
      customised(),
    );
  });

  it("re-validates: a patch with an unknown key or an invalid value throws a TypeError", () => {
    expect(() =>
      mergeUserSettings(customised(), { appearance: { fontSize: 14 } } as unknown as UserSettingsPatch),
    ).toThrow('Invalid settings patch: appearance: Unrecognized key: "fontSize"');
    expect(() => mergeUserSettings(customised(), { trading: { defaultQtyLots: 0 } })).toThrow(TypeError);
    expect(() => mergeUserSettings(customised(), null as unknown as UserSettingsPatch)).toThrow(
      "Invalid settings patch: (root): Invalid input: expected object, received null",
    );
  });

  it("re-validates: current settings that were not read with parseUserSettings throw a TypeError", () => {
    const stale = { ...customised(), appearance: { theme: "neon" } } as unknown as UserSettings;

    expect(() => mergeUserSettings(stale, { trading: { defaultQtyLots: 2 } })).toThrow(
      /^Invalid current settings \(read them with parseUserSettings\): appearance\.theme: /,
    );
    expect(() => mergeUserSettings({} as UserSettings, {})).toThrow(TypeError);
  });
});

describe("in-app delivery for broker and system notifications", () => {
  it("keeps in-app delivery on for broker and system notifications", () => {
    // Read: a stored false (written before this rule, or by hand) reads back as true.
    const stored = { notifications: { categories: { broker: { inApp: false }, system: { inApp: false } } } };
    const read = parseUserSettings(stored);
    expect(read.notifications.categories.broker.inApp).toBe(true);
    expect(read.notifications.categories.system.inApp).toBe(true);

    // Write: a patch that turns it off is rejected, by the schema and by the merge.
    for (const category of ["broker", "system"] as const) {
      const patch = { notifications: { categories: { [category]: { inApp: false } } } };
      expect(UserSettingsPatchSchema.safeParse(patch).error?.issues, category).toMatchObject([
        { code: "invalid_value", path: ["notifications", "categories", category, "inApp"] },
      ]);
      expect(() => mergeUserSettings(customised(), patch as unknown as UserSettingsPatch), category).toThrow(TypeError);
    }

    // Other categories can turn it off; the response schema never carries false for broker or system.
    expect(mergeUserSettings(customised(), { notifications: { categories: { agent: { inApp: false } } } })).toEqual(
      customised(),
    );
    const response = customised() as unknown as { notifications: { categories: { broker: { inApp: boolean } } } };
    response.notifications.categories.broker.inApp = false;
    expect(UserSettingsSchema.safeParse(response).success).toBe(false);
  });

  it("rejects turning it off at the type level", () => {
    // @ts-expect-error -- inApp is the literal true for broker notifications.
    const patch: UserSettingsPatch = { notifications: { categories: { broker: { inApp: false } } } };
    expectTypeOf<UserSettings["notifications"]["categories"]["system"]["inApp"]>().toEqualTypeOf<true>();
    expect(patch).toBeDefined();
  });
});
