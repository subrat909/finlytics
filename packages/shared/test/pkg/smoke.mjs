// check:pkg smoke test (ESM). Loads the BUILT package through its own name with import(), the way Next.js does, and
// runs zod and decimal.js through it, so a broken external (missing dependency, wrong interop) fails here.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

assert.match(import.meta.resolve("@finlytics/shared"), /\/dist\/index\.js$/, "import() must resolve to the ESM build");

const shared = await import("@finlytics/shared");

// zod at runtime
const killSwitch = {
  type: shared.problemTypeUrl("KILL_SWITCH"),
  title: shared.ERROR_TITLES.KILL_SWITCH,
  status: shared.ERROR_HTTP_STATUS.KILL_SWITCH,
  code: "KILL_SWITCH",
  requestId: "smoke-esm",
};
assert.equal(
  shared.ProblemDetailsSchema.safeParse(killSwitch).success,
  true,
  "a valid problem passes ProblemDetailsSchema",
);
assert.equal(
  shared.ProblemDetailsSchema.safeParse({ ...killSwitch, stack: "Error: x" }).success,
  false,
  "the server-side schema rejects unknown members",
);
assert.equal(
  shared.isProblemDetails({ ...killSwitch, code: "STEP_UP_REQUIRED", stepUp: {} }),
  true,
  "the client guard tolerates a newer server (RFC 9457 §3.2)",
);
assert.equal(shared.isKnownErrorCode("STEP_UP_REQUIRED"), false, "isKnownErrorCode narrows received codes");
assert.equal(
  shared.ProblemDetailsSchema.safeParse({ ...killSwitch, status: 409 }).success,
  false,
  "status, title and type are tied to the code",
);
assert.equal(shared.isRetryableErrorCode("SERVICE_UNAVAILABLE"), true, "SERVICE_UNAVAILABLE is retryable");
assert.equal(shared.IdempotencyKeySchema.safeParse(crypto.randomUUID()).success, true, "UUIDs are idempotency keys");
assert.equal(shared.SESSION_TOKEN_PATTERN.test(crypto.randomUUID()), true, "Auth.js session tokens match");
assert.equal(shared.SESSION_COOKIE_NAME.production, "__Host-authjs.session-token", "session contract is exported");
assert.equal(shared.HealthLiveSchema.safeParse({ status: "ok" }).success, true, "health schemas are exported");
assert.equal(shared.ExchangeSchema.parse("NFO"), "NFO", "enum mirrors are exported");
assert.equal(shared.DecimalStringSchema.safeParse("1e5").success, false, "DecimalStringSchema rejects exponents");

// decimal.js at runtime
assert.equal(shared.toDecimal("0.1").plus("0.2").toFixed(), "0.3", "arithmetic is exact");
assert.equal(shared.roundToTick("24000.07", "0.05", "nearest"), "24000.05", "roundToTick works");
assert.equal(shared.formatInr("-12345678.9"), "-₹1,23,45,678.90", "formatInr works");
assert.equal(shared.formatInrCompact("12300000"), "₹1.23 Cr", "formatInrCompact works");
assert.deepEqual(shared.ok(1), { ok: true, value: 1 }, "Result helpers are exported");

// Instrument keys and settings
const niftyCall = "NSE_FO|NIFTY|2025-10-30|24000|CE";
assert.equal(shared.parseInstrumentKey(niftyCall).value?.exchange, "NFO", "keys parse with their Prisma exchange");
assert.equal(shared.InstrumentKeySchema.parse(niftyCall), niftyCall, "the branded key schema works");
assert.deepEqual(shared.normalizeInstrumentKey(" nse_fo|nifty|2025-10-30|24000.00|ce "), shared.ok(niftyCall));
assert.equal(shared.instrumentKeyFromParam("%E0%A4%A").error?.reason, "ENCODING", "bad params are not thrown");
assert.deepEqual(shared.parseUserSettings(null), shared.DEFAULT_USER_SETTINGS, "settings reads never throw");
assert.equal(shared.UserSettingsPatchSchema.safeParse({ appearance: { fontSize: 1 } }).success, false);
assert.equal(
  await shared.hashSessionToken("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "Web Crypto session hashing works in the ESM build",
);
assert.equal(shared.normalizeEmail(" Asha@Example.IN "), "asha@example.in");

// Both builds in one process (plan §8): each has its own copy of zod and decimal.js, so values must cross by structure.
const cjs = createRequire(import.meta.url)("@finlytics/shared");
assert.notEqual(cjs.toDecimal, shared.toDecimal, "require() loads the separate CJS build");
assert.equal(shared.toDecimalString(cjs.toDecimal("12345678901234.5678")), "12345678901234.5678");
assert.equal(shared.isProblemDetails(cjs.ProblemDetailsSchema.parse(killSwitch)), true);
assert.equal(shared.isInstrumentKey(cjs.formatInstrumentKey({ segment: "EQ", token: "NSE_EQ", symbol: "M&M" })), true);
assert.equal(shared.canonicalStrike(cjs.toDecimal("82.50")), "82.5");

console.log("ESM smoke test passed: import() loads dist/index.js");
