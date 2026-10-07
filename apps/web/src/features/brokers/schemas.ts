/**
 * Broker accounts: the wire contract is `@finlytics/shared` (`schemas/brokers`, stream C1). This file adds what only
 * the UI needs: the wizard's brokers and friendly form messages for the shared request schemas.
 */
import { BrokerAccountLabelSchema, ConnectPaperSchema, ConnectUpstoxSchema } from "@finlytics/shared";
import type {
  BrokerAccountStatus,
  BrokerAccountView,
  BrokerLimits,
  ConnectPaper,
  ConnectUpstox,
} from "@finlytics/shared";
import { z } from "zod";

export type { BrokerAccountStatus, BrokerAccountView, BrokerLimits, ConnectPaper, ConnectUpstox };

/** The brokers a user can connect from the wizard (phase 1b): two real brokers and the built-in paper broker. */
export const CONNECTABLE_BROKERS = ["UPSTOX", "DHAN", "PAPER"] as const;
export type ConnectableBroker = (typeof CONNECTABLE_BROKERS)[number];

/**
 * Per-field messages for the connect forms (a per-parse error map: the shared schemas' own messages, such as a
 * pattern's, still win). Keyed by field, then by issue code; `default` covers the rest.
 */
const FIELD_MESSAGES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  label: {
    too_small: "Give the account a name",
    too_big: "Use at most 40 characters",
    default: "Use plain text on one line",
  },
  accessToken: { default: "That doesn't look like a Dhan access token" },
};

/** For `zodResolver(schema, { error: connectFormErrors })`. */
export const connectFormErrors: z.core.$ZodErrorMap = (issue) => {
  const field = typeof issue.path?.[0] === "string" ? issue.path[0] : "";
  const messages = FIELD_MESSAGES[field];
  if (messages === undefined) return undefined;
  return messages[issue.code] ?? messages.default;
};

/** An empty field says what to enter; anything else is checked by the shared schema (and its own message). */
function required<T extends z.ZodType<string, string>>(message: string, schema: T) {
  return z.string().trim().min(1, { error: message }).pipe(schema);
}

/** The Upstox form: the shared request schema, with friendly messages for empty fields. */
export const UpstoxFormSchema = ConnectUpstoxSchema.extend({
  apiKey: required("Paste the API key from your Upstox app", ConnectUpstoxSchema.shape.apiKey),
  apiSecret: required("Paste the API secret from your Upstox app", ConnectUpstoxSchema.shape.apiSecret),
});

/**
 * What people paste around a Dhan token, removed before it's checked or sent (the api's adapter does the same):
 * surrounding whitespace and quotes, a `Bearer ` prefix, and line breaks from a wrapped copy.
 */
export function cleanDhanToken(raw: string): string {
  const QUOTES = /^["'`]+|["'`]+$/g;
  return raw
    .trim()
    .replace(QUOTES, "")
    .trim()
    .replace(/^bearer\s+/i, "")
    .replace(QUOTES, "")
    .replace(/\s+/g, "");
}

/** `POST /v1/brokers/dhan`: the client ID is optional (the api reads it from the token) and omitted when empty. */
export interface DhanConnectInput {
  label: string;
  clientId?: string | undefined;
  accessToken: string;
}

/**
 * The Dhan form. The client ID is optional: empty becomes "omitted", anything else must look like one. The token is
 * cleaned first (a pasted `Bearer …` is fine), then checked like the api checks it.
 */
export const DhanFormSchema = z.strictObject({
  label: BrokerAccountLabelSchema,
  clientId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .pipe(
      z
        .string()
        .regex(/^[A-Za-z0-9]{1,32}$/, { error: "Use the client ID from Dhan (letters and digits), or leave it empty" })
        .optional(),
    ),
  accessToken: z
    .string()
    .transform(cleanDhanToken)
    .pipe(
      z
        .string()
        .min(1, { error: "Paste the access token from the Dhan dashboard" })
        .pipe(
          z
            .string()
            .min(16)
            .max(4096)
            .regex(/^[A-Za-z0-9._-]+$/),
        ),
    ),
}) satisfies z.ZodType<DhanConnectInput>;
export type DhanFormValues = z.input<typeof DhanFormSchema>;

/** The paper form: just a name. */
export const PaperFormSchema = ConnectPaperSchema;

/** The rename form: the shared label rules. */
export const RenameFormSchema = ConnectPaperSchema;
