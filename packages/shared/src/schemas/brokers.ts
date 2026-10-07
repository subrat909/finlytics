/**
 * Broker accounts (plan phase-1-brokers-market-data P3–P5; docs/04 §2 "Brokers"): the `/v1/brokers` request and
 * response contracts. A response never carries credentials, tokens or the broker client id (security.md).
 */
import { z } from "zod";

import { BrokerCodeSchema } from "./enums";

/** Prisma `BrokerAccountStatus`, in schema order (packages/database keeps the two equal). */
export const BROKER_ACCOUNT_STATUSES = Object.freeze([
  "PENDING",
  "ACTIVE",
  "NEEDS_RELOGIN",
  "EXPIRED",
  "REVOKED",
  "ERROR",
] as const);
export const BrokerAccountStatusSchema = z.enum(BROKER_ACCOUNT_STATUSES);
export type BrokerAccountStatus = z.infer<typeof BrokerAccountStatusSchema>;

/** Control, line-separator, bidi and BOM characters, and `<`/`>`: user text is one plain line, never HTML. */
const PLAIN_LINE = /^[^<>\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069\uFEFF]*$/u;

/** A broker account's label: 1–40 characters of plain text, trimmed (unique per user and broker). */
export const BrokerAccountLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(PLAIN_LINE, "Expected plain text on one line, without < or >");

/** A `BrokerAccount.id` in a path. */
export const BrokerAccountIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Expected a broker account id");

/** An API key or secret of the user's own broker app (Upstox): what the broker issues, never echoed back. */
const AppSecretSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{4,256}$/, "Expected 4–256 letters, digits, '-' or '_'");

/** What every broker account response carries: never credentials, tokens or the broker client id. */
export const BrokerAccountViewSchema = z.strictObject({
  id: z.string().min(1),
  broker: BrokerCodeSchema,
  label: z.string().min(1),
  status: BrokerAccountStatusSchema,
  isDefault: z.boolean(),
  /** When the broker session stops working (Upstox: 03:30 IST; Dhan: the token's expiry); null for paper. */
  tokenExpiresAt: z.iso.datetime().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  /** Why the account needs attention, in our own words (never the broker's message). */
  lastError: z.string().max(300).nullable(),
});
export type BrokerAccountView = z.infer<typeof BrokerAccountViewSchema>;

/** `GET /v1/brokers`: the user's accounts, oldest first. */
export const BrokerAccountListSchema = z.array(BrokerAccountViewSchema);

/**
 * `POST /v1/brokers/upstox`: the user's own Upstox app (registered once with our redirect URI). Creates a PENDING
 * account, or restarts the login of the account with this label.
 */
export const ConnectUpstoxSchema = z.strictObject({
  label: BrokerAccountLabelSchema,
  apiKey: AppSecretSchema,
  apiSecret: AppSecretSchema,
});
export type ConnectUpstox = z.infer<typeof ConnectUpstoxSchema>;

/** Where the browser goes next: the broker's login page (https). */
const AuthUrlSchema = z.url({ protocol: /^https$/ });

/** `POST /v1/brokers/upstox` and `POST /v1/brokers/:id/relogin`: the broker login page to open. */
export const BrokerAuthRedirectSchema = z.strictObject({
  account: BrokerAccountViewSchema,
  authUrl: AuthUrlSchema,
});
export type BrokerAuthRedirect = z.infer<typeof BrokerAuthRedirectSchema>;

/**
 * `POST /v1/brokers/dhan`: the access token generated on Dhan's web dashboard (valid 24 hours, renewed automatically)
 * and, optionally, the client id (empty or absent: read from the token and the profile). The token is accepted as
 * pasted (surrounding quotes, a `Bearer ` prefix, line breaks): the adapter cleans it. Validated with the broker before
 * anything is stored; the same label again replaces that account's token (Dhan's re-login).
 */
export const ConnectDhanSchema = z.strictObject({
  label: BrokerAccountLabelSchema,
  clientId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{0,32}$/, "Expected up to 32 letters or digits")
    .optional(),
  accessToken: z
    .string()
    .trim()
    .min(16)
    .max(4200)
    .regex(/^[A-Za-z0-9._\-\s"'`:=]+$/, "Expected the access token as copied from web.dhan.co"),
});
export type ConnectDhan = z.infer<typeof ConnectDhanSchema>;

/** `POST /v1/brokers/paper`: the built-in paper broker (no credentials, never expires). */
export const ConnectPaperSchema = z.strictObject({ label: BrokerAccountLabelSchema });
export type ConnectPaper = z.infer<typeof ConnectPaperSchema>;

/** `PATCH /v1/brokers/:id`: at least one of a new label and the default flag. */
export const UpdateBrokerAccountSchema = z
  .strictObject({
    label: BrokerAccountLabelSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((patch) => patch.label !== undefined || patch.isDefault !== undefined, "Change at least one field");
export type UpdateBrokerAccount = z.infer<typeof UpdateBrokerAccountSchema>;

/** `GET /v1/brokers/upstox/callback`: what Upstox appends to the redirect URI. Unknown members are ignored. */
export const UpstoxCallbackQuerySchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9._~-]{1,512}$/),
  state: z.string().regex(/^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{16,128}$/),
});
export type UpstoxCallbackQuery = z.infer<typeof UpstoxCallbackQuerySchema>;

/**
 * The `error` the callback appends to `/brokers?error=` when the connection failed (the account id, when known, is in
 * `account=`). `/brokers?connected=<id>` means success.
 */
export const BROKER_CALLBACK_ERRORS = Object.freeze([
  "invalid_request",
  "state_invalid",
  "session_mismatch",
  "broker_rejected",
  "broker_unavailable",
] as const);
export const BrokerCallbackErrorSchema = z.enum(BROKER_CALLBACK_ERRORS);
export type BrokerCallbackError = z.infer<typeof BrokerCallbackErrorSchema>;

/** `GET /v1/brokers/limits`: the plan's account limits and current usage (the connect wizard disables at the limit). */
export const BrokerLimitsSchema = z.strictObject({
  maxBrokerAccounts: z.int().min(0),
  brokerAccounts: z.int().min(0),
  maxPaperAccounts: z.int().min(0),
  paperAccounts: z.int().min(0),
});
export type BrokerLimits = z.infer<typeof BrokerLimitsSchema>;
