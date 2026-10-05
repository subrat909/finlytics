import { describe, expect, it } from "vitest";

import * as shared from "../index";

describe("@finlytics/shared entry point", () => {
  it("exports exactly the documented runtime API", () => {
    expect(Object.keys(shared).sort()).toEqual(
      [
        // types/result
        "err",
        "ok",
        // schemas/enums
        "BROKER_CODES",
        "BrokerCodeSchema",
        "EXCHANGES",
        "ExchangeSchema",
        "OPTION_TYPES",
        "OptionTypeSchema",
        "ORDER_TYPES",
        "OrderTypeSchema",
        "PRISMA_ENUM_MIRRORS",
        "PRODUCT_TYPES",
        "ProductTypeSchema",
        "ROLES",
        "RoleSchema",
        "SEGMENTS",
        "SegmentSchema",
        "VALIDITIES",
        "ValiditySchema",
        // schemas/errors
        "ERROR_CODES",
        "ERROR_HTTP_STATUS",
        "ERROR_TITLES",
        "ErrorCodeSchema",
        "FieldErrorSchema",
        "isKnownErrorCode",
        "isProblemDetails",
        "isRetryableErrorCode",
        "MAX_FIELD_ERRORS",
        "PROBLEM_JSON_MEDIA_TYPE",
        "ProblemDetailsSchema",
        "problemTypeUrl",
        "RETRYABLE_ERROR_CODES",
        // money
        "DecimalStringSchema",
        "formatInr",
        "formatInrCompact",
        "isOnTick",
        "MoneySchema",
        "PriceSchema",
        "QuantitySchema",
        "roundToTick",
        "toDecimal",
        "toDecimalString",
        // constants/exchanges
        "holidayCalendarFor",
        "SEGMENT_TOKEN_INFO",
        "SEGMENT_TOKENS",
        "segmentTokenFor",
        "SegmentTokenSchema",
        // instrument-key
        "canonicalStrike",
        "dateToExpiry",
        "expiryToDate",
        "formatInstrumentKey",
        "instrumentKeyFromParam",
        "InstrumentKeySchema",
        "instrumentKeyToParam",
        "isInstrumentKey",
        "MAX_INSTRUMENT_KEY_LENGTH",
        "normalizeInstrumentKey",
        "parseInstrumentKey",
        // schemas/user-settings
        "DEFAULT_USER_SETTINGS",
        "mergeUserSettings",
        "NOTIFICATION_CATEGORIES",
        "NotificationCategorySchema",
        "parseUserSettings",
        "parseUserSettingsWithIssues",
        "UserSettingsPatchSchema",
        "UserSettingsSchema",
      ].sort(),
    );
  });
});
