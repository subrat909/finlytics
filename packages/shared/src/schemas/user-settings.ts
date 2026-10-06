/**
 * User settings (plan D16): the preferences stored in `User.settings` (JSONB), returned by `GET /v1/me/settings` and
 * changed by `PATCH /v1/me/settings` (docs/04 §2).
 *
 * **Preferences only.** Settings never hold risk limits, auto-trade, the kill switch or the default broker. Those live
 * in `RiskLimit`, `AutoTradeConfig`, `TradingControl` and `BrokerAccount.isDefault`, behind step-up auth, so a settings
 * write can never loosen a trading safeguard. Keep it that way when adding fields.
 *
 * - **Read, lenient.** {@link parseUserSettings} turns whatever is stored into complete settings and never throws: each
 *   missing or invalid field falls back to its default on its own, and unknown keys are dropped.
 *   {@link parseUserSettingsWithIssues} also lists what was wrong, for the logs.
 * - **Write, strict.** {@link UserSettingsPatchSchema} validates a PATCH body: any subset of fields at any depth, with
 *   unknown keys rejected at every level. {@link mergeUserSettings} applies it to the current settings.
 * - **Response.** {@link UserSettingsSchema} is the full shape that GET and PATCH return.
 */
import { z } from "zod";

import { deepFreeze } from "../internal/deep-freeze";
import { quote } from "../internal/quote";
import { OrderTypeSchema, ProductTypeSchema, ValiditySchema } from "./enums";

// ---------------------------------------------------------------------------------------------------------------------
// Vocabularies

/** Notification categories, as stored in `Notification.category`. Each has its own delivery settings. */
export const NOTIFICATION_CATEGORIES = Object.freeze(["order", "alert", "agent", "broker", "system"] as const);
export const NotificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

const ThemeSchema = z.enum(["system", "light", "dark"]);
const DensitySchema = z.enum(["comfortable", "compact"]);
/** Where new orders go by default. Paper first: live trading is a deliberate choice (CLAUDE.md §7). */
const OrderModeSchema = z.enum(["PAPER", "LIVE"]);
/**
 * The order defaults are subsets of the Prisma enums. Stop-loss, cover and bracket orders need extra prices, so they
 * are chosen per order and are never a default.
 */
const DefaultProductSchema = ProductTypeSchema.extract(["INTRADAY", "DELIVERY", "MARGIN"]);
const DefaultOrderTypeSchema = OrderTypeSchema.extract(["MARKET", "LIMIT"]);
const DefaultValiditySchema = ValiditySchema.extract(["DAY", "IOC"]);
const DefaultQtyLotsSchema = z.int().min(1).max(100);

// ---------------------------------------------------------------------------------------------------------------------
// Strict schemas: the response and the patch

const channelShape = { push: z.boolean(), email: z.boolean(), telegram: z.boolean() };
/** How one notification category is delivered, per channel. */
const DeliverySchema = z.strictObject({ inApp: z.boolean(), ...channelShape });
/** Broker and system notifications (re-login needed, feed down, kill switch) always reach the app: `inApp: true`. */
const AlwaysInAppDeliverySchema = z.strictObject({ inApp: z.literal(true), ...channelShape });

/** Complete settings: the response of `GET` and `PATCH /v1/me/settings`. Strict at every level, all fields required. */
export const UserSettingsSchema = z.strictObject({
  appearance: z.strictObject({
    theme: ThemeSchema,
    density: DensitySchema,
  }),
  trading: z.strictObject({
    defaultOrderMode: OrderModeSchema,
    defaultProduct: DefaultProductSchema,
    defaultOrderType: DefaultOrderTypeSchema,
    defaultValidity: DefaultValiditySchema,
    /** Default order size in lots (1–100). */
    defaultQtyLots: DefaultQtyLotsSchema,
    confirmBeforePlace: z.boolean(),
  }),
  notifications: z.strictObject({
    sound: z.boolean(),
    categories: z.strictObject({
      order: DeliverySchema,
      alert: DeliverySchema,
      agent: DeliverySchema,
      broker: AlwaysInAppDeliverySchema,
      system: AlwaysInAppDeliverySchema,
    }),
  }),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/**
 * The body of `PATCH /v1/me/settings`: {@link UserSettingsSchema} with every field optional at every depth, so a client
 * sends only what changed (`{ notifications: { categories: { order: { push: false } } } }`). Still strict: an unknown
 * key at any level, `null` or an invalid value fails, and `inApp: false` for broker or system is rejected.
 */
export const UserSettingsPatchSchema = z.deepPartial(UserSettingsSchema);
export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Defaults

/** A fresh copy of the defaults on every call, so no two parses ever share an object. */
function createDefaultUserSettings(): UserSettings {
  return {
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
}

/**
 * The settings of a user who has changed nothing: system theme, paper LIMIT intraday orders of 1 lot with confirmation,
 * every category in the app, push for orders, alerts and broker events, email for broker and system events, no
 * Telegram. Frozen at every depth; {@link parseUserSettings} returns mutable copies.
 */
export const DEFAULT_USER_SETTINGS = deepFreeze(createDefaultUserSettings());

// ---------------------------------------------------------------------------------------------------------------------
// Lenient read schema (internal)
//
// - Every field falls back to its own default when it is missing (`.default`) or invalid (`.catch`), so one bad value
//   never resets its neighbours. `.default` also makes the field optional in the input type: Zod types a `.catch` field
//   as required even though it accepts a missing value at runtime.
// - Every section is `.prefault({})`, so a missing section is built from its fields' defaults (Zod 4's `.default({})`
//   would return `{}` without applying them), and `.catch(factory)`, so a section that is not an object (`null`, an
//   array, a string) gets fresh defaults. Object fallbacks come from createDefaultUserSettings, never from a shared
//   constant, so no two parses share an object.
// - `z.object` (not strict) drops unknown stored keys.

const DEFAULTS = DEFAULT_USER_SETTINGS;

/** A stored leaf: `value` when it is missing or invalid. */
function withDefault<T extends z.ZodType>(schema: T, value: z.core.util.NoUndefined<z.output<T>>) {
  return schema.default(value).catch(value);
}

function lenientChannels(category: NotificationCategory) {
  const fallback = DEFAULTS.notifications.categories[category];
  return {
    push: withDefault(z.boolean(), fallback.push),
    email: withDefault(z.boolean(), fallback.email),
    telegram: withDefault(z.boolean(), fallback.telegram),
  };
}

function lenientDelivery(category: "order" | "alert" | "agent") {
  return z
    .object({
      inApp: withDefault(z.boolean(), DEFAULTS.notifications.categories[category].inApp),
      ...lenientChannels(category),
    })
    .prefault({})
    .catch(() => createDefaultUserSettings().notifications.categories[category]);
}

/** A stored `inApp: false` (impossible through the patch schema) reads back as `true`. */
function lenientAlwaysInAppDelivery(category: "broker" | "system") {
  return z
    .object({ inApp: withDefault(z.literal(true), true), ...lenientChannels(category) })
    .prefault({})
    .catch(() => createDefaultUserSettings().notifications.categories[category]);
}

const LenientUserSettingsSchema = z
  .object({
    appearance: z
      .object({
        theme: withDefault(ThemeSchema, DEFAULTS.appearance.theme),
        density: withDefault(DensitySchema, DEFAULTS.appearance.density),
      })
      .prefault({})
      .catch(() => createDefaultUserSettings().appearance),
    trading: z
      .object({
        defaultOrderMode: withDefault(OrderModeSchema, DEFAULTS.trading.defaultOrderMode),
        defaultProduct: withDefault(DefaultProductSchema, DEFAULTS.trading.defaultProduct),
        defaultOrderType: withDefault(DefaultOrderTypeSchema, DEFAULTS.trading.defaultOrderType),
        defaultValidity: withDefault(DefaultValiditySchema, DEFAULTS.trading.defaultValidity),
        defaultQtyLots: withDefault(DefaultQtyLotsSchema, DEFAULTS.trading.defaultQtyLots),
        confirmBeforePlace: withDefault(z.boolean(), DEFAULTS.trading.confirmBeforePlace),
      })
      .prefault({})
      .catch(() => createDefaultUserSettings().trading),
    notifications: z
      .object({
        sound: withDefault(z.boolean(), DEFAULTS.notifications.sound),
        categories: z
          .object({
            order: lenientDelivery("order"),
            alert: lenientDelivery("alert"),
            agent: lenientDelivery("agent"),
            broker: lenientAlwaysInAppDelivery("broker"),
            system: lenientAlwaysInAppDelivery("system"),
          })
          .prefault({})
          .catch(() => createDefaultUserSettings().notifications.categories),
      })
      .prefault({})
      .catch(() => createDefaultUserSettings().notifications),
  })
  .catch(() => createDefaultUserSettings());

// ---------------------------------------------------------------------------------------------------------------------
// Reading

/**
 * Reads stored settings leniently. Never throws for any stored value (`{}`, `null`, an array, a string, a deeply wrong
 * shape): every missing or invalid field gets its default independently, a section that is not an object gets the
 * section's defaults, and unknown keys are dropped. Always returns complete, valid {@link UserSettings} as new objects
 * that share nothing with the input, the defaults or another call.
 */
export function parseUserSettings(raw: unknown): UserSettings {
  return LenientUserSettingsSchema.parse(raw);
}

/** {@link parseUserSettings}, plus what was wrong with the stored value. */
export interface UserSettingsWithIssues {
  readonly settings: UserSettings;
  /**
   * One line per problem, `"<path>: <message>"` with a dot path (`"(root)"` for the value as a whole), e.g.
   * `notifications.categories.broker.inApp: Invalid input: expected true` or
   * `appearance: Unrecognized key: "fontSize"`. Each named value was replaced by its default; each unknown key was
   * dropped. Missing fields are not problems. Empty when the stored value is a valid (partial) settings object.
   */
  readonly issues: string[];
}

/**
 * {@link parseUserSettings}, and the problems it repaired, so the caller can log corrupted data instead of silently
 * hiding it. A stored value has no issues exactly when it would pass {@link UserSettingsPatchSchema}: stored settings
 * are a patch over the defaults.
 */
export function parseUserSettingsWithIssues(raw: unknown): UserSettingsWithIssues {
  const check = UserSettingsPatchSchema.safeParse(raw);
  return { settings: parseUserSettings(raw), issues: check.success ? [] : check.error.issues.map(describeIssue) };
}

/** The most unknown keys one issue lists, so a corrupted object with thousands of keys can't flood the logs. */
const MAX_KEYS_LISTED = 5;

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length === 0 ? "(root)" : z.core.toDotPath(issue.path);
  if (issue.code !== "unrecognized_keys") return `${path}: ${issue.message}`;
  const listed = issue.keys.slice(0, MAX_KEYS_LISTED).map((key) => quote(key));
  const more = issue.keys.length > MAX_KEYS_LISTED ? ` and ${String(issue.keys.length - MAX_KEYS_LISTED)} more` : "";
  return `${path}: Unrecognized ${issue.keys.length === 1 ? "key" : "keys"}: ${listed.join(", ")}${more}`;
}

function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map(describeIssue).join("; ");
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing

/**
 * Applies a patch to the current settings and returns the result, re-validated against {@link UserSettingsSchema}.
 *
 * - Deep merge: objects are merged at every depth and a value replaces a value, so a patch changes only the fields it
 *   names. `undefined` means "leave unchanged".
 * - Pure: neither input is mutated, and the result shares no objects with them.
 *
 * In the API: validate the body with {@link UserSettingsPatchSchema} (400 `VALIDATION` on failure), read the stored
 * value with {@link parseUserSettings}, merge, and save, in one transaction so concurrent patches to different fields
 * don't overwrite each other.
 *
 * @throws {TypeError} when the patch fails {@link UserSettingsPatchSchema}, or `current` is not valid settings (both
 *   are programmer errors: validate the body first, and read `current` with {@link parseUserSettings}).
 */
export function mergeUserSettings(current: UserSettings, patch: UserSettingsPatch): UserSettings {
  const checkedPatch = UserSettingsPatchSchema.safeParse(patch);
  if (!checkedPatch.success) {
    throw new TypeError(`Invalid settings patch: ${describeIssues(checkedPatch.error.issues)}`);
  }
  const merged = UserSettingsSchema.safeParse(mergeTrees(current, checkedPatch.data));
  if (!merged.success) {
    throw new TypeError(
      `Invalid current settings (read them with parseUserSettings): ${describeIssues(merged.error.issues)}`,
    );
  }
  return merged.data;
}

/**
 * Deep-merges a validated patch into a base without mutating either. The patch holds only schema keys (it passed the
 * strict patch schema), so no key can reach `__proto__`.
 */
function mergeTrees(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = mergeTrees(base[key], value);
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
