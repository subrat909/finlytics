/**
 * @finlytics/shared: browser-safe contracts shared by apps/web and apps/api. Zod schemas and plain functions only; no
 * Node built-ins and nothing from Prisma (enforced by the `library` ESLint preset).
 *
 * Exports are listed by name, so the public surface stays deliberate. See README.md for usage.
 */
export {
  BROKER_CODES,
  BrokerCodeSchema,
  EXCHANGES,
  ExchangeSchema,
  OPTION_TYPES,
  OptionTypeSchema,
  ORDER_TYPES,
  OrderTypeSchema,
  PRISMA_ENUM_MIRRORS,
  PRODUCT_TYPES,
  ProductTypeSchema,
  ROLES,
  RoleSchema,
  SEGMENTS,
  SegmentSchema,
  VALIDITIES,
  ValiditySchema,
} from "./schemas/enums";
export type {
  BrokerCode,
  Exchange,
  OptionType,
  OrderType,
  ProductType,
  Role,
  Segment,
  Validity,
} from "./schemas/enums";

export {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_TITLES,
  ErrorCodeSchema,
  FieldErrorSchema,
  isKnownErrorCode,
  isProblemDetails,
  isRetryableErrorCode,
  MAX_FIELD_ERRORS,
  PROBLEM_JSON_MEDIA_TYPE,
  PROBLEM_LIMITS,
  ProblemDetailsSchema,
  problemTypeUrl,
  REQUEST_ID_PATTERN,
  RETRYABLE_ERROR_CODES,
} from "./schemas/errors";
export type {
  ErrorCode,
  FieldError,
  ProblemDetails,
  ProblemTypeUrl,
  ReceivedProblemDetails,
  RetryableErrorCode,
} from "./schemas/errors";

export { HEADERS, IdempotencyKeySchema, RequestIdSchema } from "./schemas/http";
export type { HeaderName, IdempotencyKey, RequestId } from "./schemas/http";

export { hashSessionToken, SESSION_COOKIE_NAME, SESSION_LIMITS, SESSION_TOKEN_PATTERN } from "./schemas/session";
export type { SessionCookieName } from "./schemas/session";

export { normalizeEmail } from "./email";

export { MeSchema } from "./schemas/me";
export type { Me } from "./schemas/me";

export { HealthLiveSchema, HealthReadySchema } from "./schemas/health";
export type { HealthLive, HealthReady } from "./schemas/health";

export {
  DecimalStringSchema,
  formatInr,
  formatInrCompact,
  isOnTick,
  MoneySchema,
  PriceSchema,
  QuantitySchema,
  roundToTick,
  toDecimal,
  toDecimalString,
} from "./money";
export type {
  Decimal,
  DecimalLike,
  DecimalObjectLike,
  DecimalRounding,
  FormatInrCompactOptions,
  FormatInrOptions,
  TickRounding,
} from "./money";

export {
  holidayCalendarFor,
  SEGMENT_TOKEN_INFO,
  SEGMENT_TOKENS,
  segmentTokenFor,
  SegmentTokenSchema,
} from "./constants/exchanges";
export type { HolidayCalendar, SegmentToken, SegmentTokenInfo } from "./constants/exchanges";

export {
  canonicalStrike,
  dateToExpiry,
  expiryToDate,
  formatInstrumentKey,
  instrumentKeyFromParam,
  InstrumentKeySchema,
  instrumentKeyToParam,
  isInstrumentKey,
  MAX_INSTRUMENT_KEY_LENGTH,
  normalizeInstrumentKey,
  parseInstrumentKey,
} from "./instrument-key";
export type {
  InstrumentKey,
  InstrumentKeyError,
  InstrumentKeyErrorReason,
  InstrumentKeyParts,
  IsoDate,
  ParsedInstrumentKey,
} from "./instrument-key";

export {
  DEFAULT_USER_SETTINGS,
  mergeUserSettings,
  NOTIFICATION_CATEGORIES,
  NotificationCategorySchema,
  parseUserSettings,
  parseUserSettingsWithIssues,
  UserSettingsPatchSchema,
  UserSettingsSchema,
} from "./schemas/user-settings";
export type {
  NotificationCategory,
  UserSettings,
  UserSettingsPatch,
  UserSettingsWithIssues,
} from "./schemas/user-settings";

export { err, ok } from "./types/result";
export type { Err, Ok, Result } from "./types/result";
