# @finlytics/shared

Browser-safe contracts shared by `apps/web` (Next.js) and `apps/api` (NestJS): Zod schemas and plain functions. Import
everything from the package root:

```ts
import { formatInr, isProblemDetails, PriceSchema, toDecimal } from "@finlytics/shared";
```

## Rules for this package

- **Browser-safe.** No Node built-ins, no Node globals (`process`, `Buffer`), nothing from Prisma or
  `@finlytics/database`. The `library` ESLint preset enforces it for everything under `src/`.
- **Runtime dependencies: `zod` and `decimal.js` only.**
- **No `instanceof` across packages.** One process can hold two copies of zod and decimal.js: the ESM and CJS builds
  of this package each load their own, and Prisma bundles its own decimal.js. Detect values by structure
  (`DecimalLike`, `isProblemDetails`).
- **Exports are listed by name** in `src/index.ts`. `src/__tests__/index.test.ts` pins the runtime surface, so a new
  export is a deliberate change.
- Built with tsdown into ESM (`dist/index.js`), CJS (`dist/index.cjs`) and declarations for both (plan D1).

## Contents

| Section                                    | Source                                                |
| ------------------------------------------ | ----------------------------------------------------- |
| [Result](#result)                          | `src/types/result.ts`                                 |
| [Enums](#enums-prisma-mirrors)             | `src/schemas/enums.ts`                                |
| [Money](#money)                            | `src/money.ts`                                        |
| [Errors](#errors-rfc-9457-problem-details) | `src/schemas/errors.ts`                               |
| [Instrument keys](#instrument-keys)        | `src/instrument-key.ts`, `src/constants/exchanges.ts` |
| [User settings](#user-settings)            | `src/schemas/user-settings.ts`                        |

## Result

Expected failures (bad input) are returned, not thrown:

```ts
type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

const result = parseSomething(input); // Result<Parsed, ParseError>
if (!result.ok) return showError(result.error.message);
use(result.value);
```

- Build results with `ok(value)` and `err(error)`.
- Error payloads are plain objects with a string-literal `reason` and a human-readable `message`, e.g.
  `{ reason: "EXPIRY", message: 'Expiry "2026-02-30" is not a calendar date' }`. Messages quote caller input
  truncated to 40 characters.
- Throw only for programmer errors: a wrong argument type, an impossible state.

## Enums (Prisma mirrors)

Zod mirrors of the Prisma enums that cross the wire, so the browser never needs Prisma (plan D17). Each enum has a
value tuple, a schema and a type:

| Tuple           | Schema              | Values (same order as `schema.prisma`)                              |
| --------------- | ------------------- | ------------------------------------------------------------------- |
| `EXCHANGES`     | `ExchangeSchema`    | NSE, BSE, MCX, NFO, BFO, CDS                                        |
| `SEGMENTS`      | `SegmentSchema`     | EQ, INDEX, FUT, OPT (instrument kind; asset class follows exchange) |
| `OPTION_TYPES`  | `OptionTypeSchema`  | CE, PE                                                              |
| `BROKER_CODES`  | `BrokerCodeSchema`  | UPSTOX, DHAN, ZERODHA, ANGELONE, FYERS, SHOONYA, PAPER              |
| `ROLES`         | `RoleSchema`        | USER, PRO, ADMIN                                                    |
| `ORDER_TYPES`   | `OrderTypeSchema`   | MARKET, LIMIT, SL, SL_M                                             |
| `PRODUCT_TYPES` | `ProductTypeSchema` | INTRADAY, DELIVERY, MARGIN, CO, BO                                  |
| `VALIDITIES`    | `ValiditySchema`    | DAY, IOC                                                            |

`PRISMA_ENUM_MIRRORS` maps each Prisma enum name to its tuple. A sync test in `packages/database` compares it with the
generated client, so changing an enum in `schema.prisma` without changing it here fails CI.

## Money

Prices and amounts are exact decimals end to end (plan D14). Never `number`: binary floats can't represent most prices.

| Layer      | Representation                                    |
| ---------- | ------------------------------------------------- |
| Wire       | decimal string: `"24000.05"`, `"-1500.5"`         |
| Postgres   | `Decimal(18,4)` (Prisma `Decimal`)                |
| Logic      | decimal.js, through `toDecimal`                   |
| Quantities | integers (`Int`), validated with `QuantitySchema` |

### Wire schemas

| Schema                | Accepts                                                    |
| --------------------- | ---------------------------------------------------------- |
| `DecimalStringSchema` | `/^-?(0\|[1-9]\d{0,13})(\.\d{1,4})?$/`: fits Decimal(18,4) |
| `PriceSchema`         | the same, non-negative (prices, strikes, tick sizes)       |
| `MoneySchema`         | the same, signed (P&L, funds, charges)                     |
| `QuantitySchema`      | an integer from 1 to 2,147,483,647                         |

Rejected: leading zeros (`"01.5"`), exponents (`"1e5"`), `+`, more than 4 decimals, more than 14 integer digits,
whitespace, separators (`"1,000"`) and numbers.

### Arithmetic

```ts
const pnl = toDecimal(exitPrice).minus(entryPrice).times(qty); // Decimal: exact, 40 significant digits
toDecimalString(pnl); // canonical wire string, e.g. "1234.5"
roundToTick("24000.07", "0.05", "nearest"); // "24000.05"
isOnTick("24000.05", "0.05"); // true
```

- **`DecimalLike`** is `string | Decimal | object with toFixed()`. A Prisma `Decimal` goes straight in
  (`toDecimalString(row.avgPrice)`) and is read through `toFixed()`, so no float is involved. A `number` is a type error
  and, for untyped callers, a `TypeError`. Integer quantities may be passed to Decimal methods (`times(qty)`), which
  is exact.
- **`toDecimal(x)`** returns a Decimal from a private `Decimal.clone` (precision 40, half-up). Its methods keep that
  configuration. Strings must be plain notation: any number of decimals, but no exponent, `+`, whitespace or leading
  zeros.
- **`toDecimalString(x, rounding = "half-up")`** gives the canonical wire form: at most 4 decimals, trailing zeros
  trimmed, never an exponent, never `"-0"`. Canonical strings come back unchanged. Throws a `RangeError` beyond 14
  integer digits (after rounding).
- **`roundToTick(price, tick, mode)`**: `mode` is required. `"down"` is floor and `"up"` is ceil in value terms, also
  for negative prices; `"nearest"` breaks ties away from zero. The tick must be greater than 0 with at most 4 decimals.

| Rounding  | `toDecimalString` | `roundToTick` | Meaning                              |
| --------- | ----------------- | ------------- | ------------------------------------ |
| nearest   | `"half-up"`       | `"nearest"`   | ties away from zero (-2.5 → -3)      |
| banker's  | `"half-even"`     | –             | ties to the even neighbour (2.5 → 2) |
| toward −∞ | `"down"`          | `"down"`      | floor (-1.03 → -1.05 on a 0.05 tick) |
| toward +∞ | `"up"`            | `"up"`        | ceil (-1.03 → -1 on a 0.05 tick)     |

Don't call `Decimal.set()`, don't use `instanceof Decimal`, and don't convert prices with `Number()`/`parseFloat` for
arithmetic. decimal.js is too slow for per-tick live P&L; that hot path uses scaled integers (plan carry-forward 11).

### Formatting

`formatInr` and `formatInrCompact` use Indian grouping and units, and no `Intl`, so the server render and the browser
hydration produce identical text.

| Value             | `formatInr(x)`           | `formatInrCompact(x)` |
| ----------------- | ------------------------ | --------------------- |
| `"0"`             | `₹0.00`                  | `₹0`                  |
| `"999.5"`         | `₹999.50`                | `₹999.5`              |
| `"12300"`         | `₹12,300.00`             | `₹12.3 K`             |
| `"99999.999"`     | `₹1,00,000.00`           | `₹1 L`                |
| `"4560000"`       | `₹45,60,000.00`          | `₹45.6 L`             |
| `"-12345678.9"`   | `-₹1,23,45,678.90`       | `-₹1.23 Cr`           |
| `"1000000000000"` | `₹10,00,00,00,00,000.00` | `₹1,00,000 Cr`        |

- `formatInr(x, { decimals = 2, sign = "auto", symbol = true })`: `decimals` is 0, 2 or 4, always all shown, rounded
  half-up. `sign: "always"` adds `+` to positive values. The sign is decided after rounding, so zero is never signed
  (`"-0.001"` → `₹0.00`).
- `formatInrCompact(x, { maxDecimals = 2 })`: K from 1,000, L (lakh) from 1,00,000, Cr (crore) from 1,00,00,000. At
  most `maxDecimals` decimals (0–4), rounded half-up, trailing zeros trimmed. The unit is chosen by magnitude and the
  number is then rounded; if rounding carries it up to the next unit, the next unit is used (as Intl's compact notation
  does): 99,999.999 is `₹1 L`, never `₹100 K`, while 99,994.99 stays `₹99.99 K`.

## Errors (RFC 9457 problem details)

Every API error is a problem details object (RFC 9457, which replaces RFC 7807) with media type
`application/problem+json` (`PROBLEM_JSON_MEDIA_TYPE`). The full contract, with the reasons behind each status, is in
`docs/04-API-DESIGN.md` §6.

```json
{
  "type": "https://finlytics.app/errors/broker-rejected",
  "title": "Broker rejected the request",
  "status": 422,
  "code": "BROKER_REJECTED",
  "detail": "Insufficient margin",
  "requestId": "req_01J9Z6Y3K8",
  "broker": { "code": "DH-906", "message": "Margin shortfall" }
}
```

| Export                 | Use                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `ErrorCodeSchema`      | the stable codes (`ERROR_CODES` tuple, `ErrorCode` type)                                             |
| `ERROR_HTTP_STATUS`    | code → HTTP status; literal types, e.g. `ERROR_HTTP_STATUS.KILL_SWITCH` is `423`                     |
| `ERROR_TITLES`         | code → `title`                                                                                       |
| `problemTypeUrl(code)` | code → `type`: `https://finlytics.app/errors/<kebab-code>`                                           |
| `ProblemDetailsSchema` | server side: the whole object, strict at every level, so a stack trace or SQL error can't ride along |
| `isProblemDetails(x)`  | client side: tolerant type guard for a parsed response body (RFC 9457 §3.2, see below)               |
| `isKnownErrorCode(c)`  | narrows a received `code` to `ErrorCode`; false for codes newer than this build                      |
| `isRetryableErrorCode` | true only for `RATE_LIMITED` and `BROKER_UNAVAILABLE` (takes any received code)                      |
| `FieldErrorSchema`     | one entry of `errors[]`: `{ path, message, code? }`, at most `MAX_FIELD_ERRORS` (100)                |

Server side, derive everything from the code:

```ts
const problem: ProblemDetails = {
  type: problemTypeUrl(code),
  title: ERROR_TITLES[code],
  status: ERROR_HTTP_STATUS[code],
  code,
  requestId,
};
```

Client side, branch on `code`, never on `title` or `detail`. A bundle in an open tab can be older than the server, so
`isProblemDetails` follows RFC 9457 §3.2: it ignores members it doesn't know and accepts codes this build has never
seen (`body.code` is a `string`). Narrow with `isKnownErrorCode` before an exhaustive `switch`:

```ts
const body: unknown = await response.json();
if (isProblemDetails(body)) {
  for (const fieldError of body.errors ?? []) form.setError(fieldError.path, { message: fieldError.message });
  if (body.code === "NEEDS_RELOGIN") showBrokerReloginBanner();
  if (isRetryableErrorCode(body.code)) scheduleRetry(body.retryAfterSec);
  if (!isKnownErrorCode(body.code)) showGenericError(body.requestId); // a code newer than this bundle
}
```

- `errors[].path` is a dot path into the request body, the way react-hook-form names fields (`"legs.0.strike"`); `""`
  means the body as a whole.
- `INSUFFICIENT_FUNDS` is only for our own pre-trade check. A broker's margin rejection is `BROKER_REJECTED`, with the
  broker's code in `broker.code`.
- `NEEDS_RELOGIN` is 409, never 401: a 401 would sign the user out of Finlytics, when only the broker session expired.

## Instrument keys

One canonical key names an instrument everywhere: the `Instrument` primary key, realtime rooms, Redis quote keys and
the `instrumentKey` column of the compressed hypertables (plan D13).

> **Keys are primary keys, so the grammar is permanent.** Changing it would mean rewriting primary keys and compressed
> history. A segment token can be added; nothing else changes.

```
key    = token "|" symbol                               ; *_EQ, *_INDEX tokens
       | token "|" symbol "|" expiry                    ; FUT (NSE_FO, NSE_CD, BSE_FO, MCX_FO)
       | token "|" symbol "|" expiry "|" strike "|" opt ; OPT
symbol = 1–64 of [A-Z0-9 &\-._()/], starts [A-Z0-9], no trailing/double spaces, never "|"
expiry = YYYY-MM-DD, real calendar date, 2000–2099
strike = /^(0|[1-9]\d{0,13})(\.\d{0,3}[1-9])?$/ and > 0   ; "24000", "82.5", never "24000.00"
opt    = CE | PE ; whole key ≤ 128 chars, checked before any pattern
```

- Symbols are uppercase; display case lives in `Instrument.name`. For FUT and OPT keys the symbol is the underlying.
- The strike is in the canonical form `toDecimalString` produces for a positive `Decimal(18,4)`: no leading or
  trailing zeros, at most 4 decimals.
- Parsing checks the length first, then splits on `|`. Each regex runs on one part of at most 128 characters and can't
  backtrack catastrophically, so parsing is linear in the input.

### Segment tokens

The token decides the Prisma `Exchange` and which `Segment`s (instrument kinds) a key can be; for F&O tokens the
number of parts picks FUT (3) or OPT (5). `SEGMENT_TOKEN_INFO` holds the table (frozen at every depth),
`segmentTokenFor(exchange, segment)` looks it up the other way (`("NFO", "OPT")` → `"NSE_FO"`, `("NSE", "FUT")` →
`undefined`), and `holidayCalendarFor(exchange)` names the `MarketHoliday` calendar an exchange trades on (plan D12).

| Token       | Exchange | Kinds    | Holiday calendar                       |
| ----------- | -------- | -------- | -------------------------------------- |
| `NSE_EQ`    | NSE      | EQ       | NSE                                    |
| `NSE_INDEX` | NSE      | INDEX    | NSE                                    |
| `NSE_FO`    | NFO      | FUT, OPT | NSE                                    |
| `NSE_CD`    | CDS      | FUT, OPT | CDS (also closed on bank holidays)     |
| `BSE_EQ`    | BSE      | EQ       | BSE                                    |
| `BSE_INDEX` | BSE      | INDEX    | BSE                                    |
| `BSE_FO`    | BFO      | FUT, OPT | BSE                                    |
| `MCX_FO`    | MCX      | FUT, OPT | MCX (rows record which session closes) |

### Strict parse, lenient normalize

```ts
parseInstrumentKey("NSE_FO|NIFTY|2025-10-30|24000|CE");
// { ok: true, value: { key: "NSE_FO|NIFTY|2025-10-30|24000|CE", token: "NSE_FO", exchange: "NFO",
//   segment: "OPT", symbol: "NIFTY", expiry: "2025-10-30", strike: "24000", optionType: "CE" } }
parseInstrumentKey("NSE_FO|NIFTY|2026-02-30");
// { ok: false, error: { reason: "EXPIRY", message: 'Expiry "2026-02-30" is not a calendar date' } }
normalizeInstrumentKey(" nse_fo | nifty | 2025-10-30 | 24000.00 | ce ");
// { ok: true, value: "NSE_FO|NIFTY|2025-10-30|24000|CE" }
```

- **`parseInstrumentKey` is strict**: canonical keys only. Use it for keys from our database, API and realtime
  messages. `InstrumentKeySchema` (a branded Zod schema) and `isInstrumentKey` apply the same rules.
- **`normalizeInstrumentKey` is lenient**, for keys typed by people or sent by brokers. It trims the key and the
  whitespace around each part (`" nse_eq | infy "`), uppercases ASCII letters, and canonicalises the strike
  (`"24000.00"` → `"24000"`). Nothing else is repaired:
  - only ASCII is uppercased, so a look-alike such as `ı` (dotless i) is rejected instead of becoming `I`;
  - whitespace inside a part is kept, so a symbol with a double space is still rejected;
  - a strike with more than 4 significant decimals is rejected, never rounded;
  - the expiry must already be `YYYY-MM-DD`, and the trimmed key at most 128 characters.

  Its output always passes `parseInstrumentKey`, and normalising a normalised key changes nothing.

- **Errors** in the input are returned, never thrown, with a `reason` to branch on (only a non-string argument throws,
  a `TypeError`). Parts are checked in key order and the first failure wins.

  | Reason        | Meaning                                                                      |
  | ------------- | ---------------------------------------------------------------------------- |
  | `LENGTH`      | longer than 128 characters (checked before anything else)                    |
  | `TOKEN`       | the first part is not a segment token                                        |
  | `ARITY`       | wrong number of parts for the token                                          |
  | `SYMBOL`      | symbol outside the grammar, e.g. lowercase or a trailing space               |
  | `EXPIRY`      | not a `YYYY-MM-DD` calendar date from 2000 to 2099                           |
  | `STRIKE`      | not canonical (strict) or not a positive decimal with ≤ 4 decimals (lenient) |
  | `OPTION_TYPE` | not `CE` or `PE`                                                             |
  | `ENCODING`    | `instrumentKeyFromParam` only: the parameter is not valid percent-encoding   |

- **Branded types.** `InstrumentKey` is `string & z.$brand<"InstrumentKey">` (Zod 4's brand): only the parsers,
  `formatInstrumentKey` and `InstrumentKeySchema` produce one, and `isInstrumentKey` narrows to one, so a value typed
  `InstrumentKey` has been validated. A plain string doesn't type-check as one. `IsoDate` (an expiry) works the same
  way.
- **Building keys.** `formatInstrumentKey({ segment, token, symbol, expiry?, strike?, optionType? })` joins valid parts
  and throws a `RangeError` (with the `InstrumentKeyError` as its `cause`) for invalid ones; a parsed key is valid
  input. Render strikes with `canonicalStrike(x)`, which accepts any `DecimalLike` (a Prisma `Decimal` column too).
  For data that may be invalid, build the string and call `normalizeInstrumentKey`, which returns a `Result`.
- **Expiry dates are UTC-only.** `expiryToDate("2025-10-30")` is `2025-10-30T00:00:00.000Z`, which is how Prisma reads
  and writes `@db.Date`. `dateToExpiry(date)` rejects a Date with a time of day instead of truncating it: midnight IST
  on 30 October is 18:30 UTC on the 29th, which would silently become the wrong expiry. Build dates with `Date.UTC`.

### URL encoding

Keys contain `|`, spaces, `&` and `/`, so always encode them in URLs:

```ts
const href = `/instruments/${instrumentKeyToParam(key)}`; // "/instruments/NSE_INDEX%7CNIFTY%2050"
const parsed = instrumentKeyFromParam(params.key); // Result<ParsedInstrumentKey, InstrumentKeyError>
if (!parsed.ok) notFound();
```

- `instrumentKeyToParam` is `encodeURIComponent`: the result is one path segment that can't split the path or query.
- `instrumentKeyFromParam` decodes, then parses strictly, and never throws for a string. Malformed percent-encoding is
  an `ENCODING` error; a parameter longer than 384 characters (3 per key character) is a `LENGTH` error before
  anything is decoded.
- It is safe on a parameter the framework has already decoded: `%` is not in the grammar, so decoding a valid key
  again leaves it unchanged.
- In query strings, `URLSearchParams` encodes and decodes for you (spaces as `+`); pass the decoded value to
  `parseInstrumentKey`.

## User settings

The preferences stored in `User.settings` (JSONB) and served by `GET/PATCH /v1/me/settings` (plan D16, docs/04 §2).
Settings never hold risk limits, auto-trade, the kill switch or the default broker: those live in `RiskLimit`,
`AutoTradeConfig`, `TradingControl` and `BrokerAccount.isDefault`, behind step-up auth.

| Field                                   | Values                               | Default       |
| --------------------------------------- | ------------------------------------ | ------------- |
| `appearance.theme`                      | `system`, `light`, `dark`            | `system`      |
| `appearance.density`                    | `comfortable`, `compact`             | `comfortable` |
| `trading.defaultOrderMode`              | `PAPER`, `LIVE`                      | `PAPER`       |
| `trading.defaultProduct`                | `INTRADAY`, `DELIVERY`, `MARGIN`     | `INTRADAY`    |
| `trading.defaultOrderType`              | `MARKET`, `LIMIT`                    | `LIMIT`       |
| `trading.defaultValidity`               | `DAY`, `IOC`                         | `DAY`         |
| `trading.defaultQtyLots`                | integer 1–100                        | `1`           |
| `trading.confirmBeforePlace`            | boolean                              | `true`        |
| `notifications.sound`                   | boolean                              | `true`        |
| `notifications.categories.<category>.*` | `inApp`, `push`, `email`, `telegram` | below         |

| Category (`NOTIFICATION_CATEGORIES`) | `inApp`       | `push`  | `email` | `telegram` |
| ------------------------------------ | ------------- | ------- | ------- | ---------- |
| `order`                              | `true`        | `true`  | `false` | `false`    |
| `alert`                              | `true`        | `true`  | `false` | `false`    |
| `agent`                              | `true`        | `false` | `false` | `false`    |
| `broker`                             | always `true` | `true`  | `true`  | `false`    |
| `system`                             | always `true` | `false` | `true`  | `false`    |

### Read, patch, merge

```ts
// GET: read whatever is stored; log what had to be repaired.
const { settings, issues } = parseUserSettingsWithIssues(user.settings);
if (issues.length > 0) logger.warn({ issues }, "repaired stored settings");

// PATCH: strict body, deep merge into the stored value, re-validated. Read, merge and save in one transaction.
const patch = UserSettingsPatchSchema.parse(body); // 400 VALIDATION with errors[] on failure
const next = mergeUserSettings(parseUserSettings(user.settings), patch);
```

- **Read: `parseUserSettings(raw)`** never throws, whatever is stored (`{}`, `null`, an array, a string, a wrong
  shape). Each missing or invalid field gets its own default, a section that is not an object gets the section's
  defaults, and unknown keys are dropped. It always returns complete, valid settings as new objects.
  `parseUserSettingsWithIssues(raw)` also returns `issues`: one readable line per repair, such as
  `appearance.theme: Invalid option: expected one of "system"|"light"|"dark"` or
  `(root): Unrecognized key: "legacy"`. Missing fields are not issues.
- **Patch: `UserSettingsPatchSchema`** is `UserSettingsSchema` with every field optional at every depth, and strict at
  every level: an unknown key, `null` or an invalid value fails. Send only what changed, e.g.
  `{ notifications: { categories: { order: { push: false } } } }`.
- **Merge: `mergeUserSettings(current, patch)`** is a pure deep merge: objects merge at every depth, a value replaces a
  value, `undefined` leaves a field unchanged. Neither input is mutated and the result shares no objects with them.
  The result is re-validated against `UserSettingsSchema`; an invalid patch, or `current` that was not read with
  `parseUserSettings`, throws a `TypeError` (a programmer error: the controller validates the body first).
- **Response: `UserSettingsSchema`** is the complete, strict shape that GET and PATCH return.
- `DEFAULT_USER_SETTINGS` is frozen at every depth; parsing returns mutable copies.
- `inApp` for `broker` and `system` is the literal `true`: a patch that sets it to `false` is rejected, and a stored
  `false` reads back as `true`.

## Development

```sh
pnpm --filter @finlytics/shared build      # tsdown: dist/ (ESM, CJS, declarations)
pnpm --filter @finlytics/shared test       # vitest with coverage; fails below 90% on any metric
pnpm --filter @finlytics/shared typecheck
pnpm --filter @finlytics/shared lint
pnpm --filter @finlytics/shared check:pkg  # after build: publint, attw, ESM and CJS smoke tests
```

Tests live in `src/__tests__/`: `*.test.ts` for examples, `*.property.test.ts` for fast-check properties. Name tests
by behaviour.
