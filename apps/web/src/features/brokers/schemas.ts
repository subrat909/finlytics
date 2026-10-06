/**
 * Broker accounts: the wire contract is `@finlytics/shared` (`schemas/brokers`, stream C1). This file adds what only
 * the UI needs: the wizard's brokers and friendly form messages for the shared request schemas.
 */
import { ConnectDhanSchema, ConnectUpstoxSchema } from "@finlytics/shared";
import type { BrokerAccountStatus, BrokerAccountView, ConnectDhan, ConnectUpstox } from "@finlytics/shared";
import { z } from "zod";

export type { BrokerAccountStatus, BrokerAccountView, ConnectDhan, ConnectUpstox };

/** The brokers a user can connect from the wizard (phase 1). */
export const CONNECTABLE_BROKERS = ["UPSTOX", "DHAN"] as const;
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

/** The Dhan form: the shared request schema, with friendly messages for empty fields. */
export const DhanFormSchema = ConnectDhanSchema.extend({
  clientId: required("Enter your Dhan client ID", ConnectDhanSchema.shape.clientId),
  accessToken: required("Paste the access token from the Dhan dashboard", ConnectDhanSchema.shape.accessToken),
});
