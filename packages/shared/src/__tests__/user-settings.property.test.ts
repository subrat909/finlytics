import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_USER_SETTINGS,
  mergeUserSettings,
  parseUserSettings,
  parseUserSettingsWithIssues,
  UserSettingsPatchSchema,
  UserSettingsSchema,
} from "../schemas/user-settings";
import type { UserSettings, UserSettingsPatch } from "../schemas/user-settings";

const RUNS = { numRuns: 500 };

// ---------------------------------------------------------------------------------------------------------------------
// Arbitraries

const theme = fc.constantFrom("system", "light", "dark");
const density = fc.constantFrom("comfortable", "compact");
const trading = {
  defaultOrderMode: fc.constantFrom("PAPER", "LIVE"),
  defaultProduct: fc.constantFrom("INTRADAY", "DELIVERY", "MARGIN"),
  defaultOrderType: fc.constantFrom("MARKET", "LIMIT"),
  defaultValidity: fc.constantFrom("DAY", "IOC"),
  defaultQtyLots: fc.integer({ min: 1, max: 100 }),
  confirmBeforePlace: fc.boolean(),
};
const channels = { push: fc.boolean(), email: fc.boolean(), telegram: fc.boolean() };
const delivery = { inApp: fc.boolean(), ...channels };
const alwaysInApp = { inApp: fc.constant(true as const), ...channels };

/** Any valid, complete settings. */
const settings: fc.Arbitrary<UserSettings> = fc.record({
  appearance: fc.record({ theme, density }),
  trading: fc.record(trading),
  notifications: fc.record({
    sound: fc.boolean(),
    categories: fc.record({
      order: fc.record(delivery),
      alert: fc.record(delivery),
      agent: fc.record(delivery),
      broker: fc.record(alwaysInApp),
      system: fc.record(alwaysInApp),
    }),
  }),
});

/** Any valid patch: every key at every level may be absent. */
const optional = { requiredKeys: [] as [] };
const patch: fc.Arbitrary<UserSettingsPatch> = fc.record(
  {
    appearance: fc.record({ theme, density }, optional),
    trading: fc.record(trading, optional),
    notifications: fc.record(
      {
        sound: fc.boolean(),
        categories: fc.record(
          {
            order: fc.record(delivery, optional),
            alert: fc.record(delivery, optional),
            agent: fc.record(delivery, optional),
            broker: fc.record(alwaysInApp, optional),
            system: fc.record(alwaysInApp, optional),
          },
          optional,
        ),
      },
      optional,
    ),
  },
  optional,
);

/** Values that are invalid for every leaf: not a boolean, not one of the enum strings, not an integer from 1 to 100. */
const INVALID_LEAF_VALUES = [null, "", "x", "TRUE", -1, 1.5, 1e9, [], {}];

// ---------------------------------------------------------------------------------------------------------------------
// Paths

type Path = readonly string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every leaf of the settings tree, e.g. `["notifications", "categories", "order", "push"]`. */
function leafPaths(value: unknown, prefix: Path = []): Path[] {
  if (!isRecord(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, key]));
}

const LEAF_PATHS = leafPaths(DEFAULT_USER_SETTINGS);

function getAt(value: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);
}

function parentOf(value: Record<string, unknown>, path: Path): Record<string, unknown> {
  const parent = getAt(value, path.slice(0, -1));
  if (!isRecord(parent)) throw new Error(`no object at ${path.join(".")}`);
  return parent;
}

function setAt(value: Record<string, unknown>, path: Path, leaf: unknown): void {
  parentOf(value, path)[path.at(-1) ?? ""] = leaf;
}

function deleteAt(value: Record<string, unknown>, path: Path): void {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test helper over known settings paths.
  delete parentOf(value, path)[path.at(-1) ?? ""];
}

// ---------------------------------------------------------------------------------------------------------------------

describe("user settings properties", () => {
  it("has 29 leaves, so the generators below cover every field", () => {
    expect(LEAF_PATHS).toHaveLength(29);
  });

  it("never throws, and always returns complete, valid settings with bounded, readable issues", () => {
    const anyValue = fc.oneof(
      fc.anything({
        maxDepth: 4,
        withBigInt: true,
        withBoxedValues: true,
        withDate: true,
        withMap: true,
        withNullPrototype: true,
        withObjectString: true,
        withSet: true,
        withSparseArray: true,
        withTypedArray: true,
      }),
      fc.jsonValue({ maxDepth: 4 }),
      // Settings-shaped values with random JSON in random places.
      fc.record(
        {
          appearance: fc.oneof(fc.record({ theme: fc.jsonValue(), density: fc.jsonValue() }), fc.jsonValue()),
          trading: fc.oneof(
            fc.dictionary(fc.constantFrom(...Object.keys(trading), "extra"), fc.jsonValue()),
            fc.jsonValue(),
          ),
          notifications: fc.jsonValue(),
        },
        optional,
      ),
    );

    fc.assert(
      fc.property(anyValue, (raw) => {
        const parsed = parseUserSettings(raw);
        const { settings: again, issues } = parseUserSettingsWithIssues(raw);

        expect(UserSettingsSchema.safeParse(parsed).success).toBe(true);
        expect(again).toEqual(parsed);
        // At most one issue per leaf plus one unknown-keys issue per object (29 + 10).
        expect(issues.length).toBeLessThanOrEqual(39);
        for (const issue of issues) {
          expect(issue).toMatch(/^(\(root\)|[A-Za-z]+(\.[A-Za-z]+)*): \S/);
          expect(issue.length).toBeLessThanOrEqual(400);
        }
      }),
      RUNS,
    );
  });

  it("keeps every valid stored value, defaults the rest, and reports exactly the invalid ones", () => {
    const leafPlan = fc.array(
      fc.tuple(fc.constantFrom("keep", "drop", "invalid"), fc.constantFrom(...INVALID_LEAF_VALUES)),
      {
        minLength: LEAF_PATHS.length,
        maxLength: LEAF_PATHS.length,
      },
    );

    fc.assert(
      fc.property(settings, leafPlan, (base, plan) => {
        const stored = structuredClone(base) as unknown as Record<string, unknown>;
        const expected = structuredClone(base) as unknown as Record<string, unknown>;
        const invalidPaths: string[] = [];
        LEAF_PATHS.forEach((path, index) => {
          const [choice, invalidValue] = plan[index] ?? ["keep", null];
          if (choice === "keep") return;
          setAt(expected, path, getAt(DEFAULT_USER_SETTINGS, path));
          if (choice === "drop") {
            deleteAt(stored, path);
          } else {
            setAt(stored, path, invalidValue);
            invalidPaths.push(path.join("."));
          }
        });

        const { settings: read, issues } = parseUserSettingsWithIssues(stored);

        expect(read).toEqual(expected);
        expect(issues.map((issue) => issue.slice(0, issue.indexOf(": "))).sort()).toEqual(invalidPaths.sort());
      }),
      RUNS,
    );
  });

  it("changes only the fields a patch names, and the result reads back unchanged", () => {
    fc.assert(
      fc.property(settings, patch, (current, p) => {
        expect(UserSettingsPatchSchema.safeParse(p).success).toBe(true);

        const merged = mergeUserSettings(current, p);

        for (const path of LEAF_PATHS) {
          const patched = getAt(p, path);
          expect(getAt(merged, path), path.join(".")).toEqual(patched === undefined ? getAt(current, path) : patched);
        }
        expect(parseUserSettingsWithIssues(merged)).toEqual({ settings: merged, issues: [] });
      }),
      RUNS,
    );
  });

  it("is idempotent: applying the same patch twice changes nothing more", () => {
    fc.assert(
      fc.property(settings, patch, (current, p) => {
        const once = mergeUserSettings(current, p);

        expect(mergeUserSettings(once, p)).toEqual(once);
      }),
      RUNS,
    );
  });

  it("reads any complete settings back unchanged, and any patch as itself over the defaults", () => {
    fc.assert(
      fc.property(settings, patch, (complete, p) => {
        expect(parseUserSettings(complete)).toEqual(complete);
        expect(parseUserSettings(p)).toEqual(mergeUserSettings(DEFAULT_USER_SETTINGS, p));
      }),
      RUNS,
    );
  });
});
