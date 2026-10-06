/**
 * Broker credentials (plan B5). Tokens are wrapped in {@link Secret}, so logging, `JSON.stringify` or string
 * interpolation of a credentials object prints `[REDACTED]`, never the token. Only adapters call `reveal()`, at the
 * moment they build a request. `BrokerVaultService` (apps/api) stores the JSON form encrypted; nothing else persists it.
 */
import { z } from "zod";

const REDACTED = "[REDACTED]";
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** A secret string that never prints itself. */
export class Secret {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /** @throws {TypeError} for an empty or non-string value. */
  static of(value: string): Secret {
    if (typeof value !== "string" || value.length === 0) throw new TypeError("A secret must be a non-empty string");
    return new Secret(value);
  }

  /** The secret itself. Call it only where it goes on the wire to the broker. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [INSPECT](): string {
    return `Secret(${REDACTED})`;
  }
}

/** Whether a value is a {@link Secret} of this module. */
export function isSecret(value: unknown): value is Secret {
  return value instanceof Secret;
}

/** What an adapter needs to call the broker for one account. */
export interface BrokerCredentials {
  readonly accessToken: Secret;
  readonly refreshToken?: Secret | undefined;
  /** When the access token stops working (Upstox: 03:30 IST next day; Dhan: 30 days). */
  readonly expiresAt?: Date | undefined;
  /** The broker's client/user id. PII: the api stores it encrypted (`BrokerAccount.brokerClientIdEnc`). */
  readonly clientId?: string | undefined;
  /** Broker-specific secrets (an API key paired with the token, for example). */
  readonly extra?: Readonly<Record<string, Secret>> | undefined;
}

/** Every secret value inside `creds`, for redaction. */
export function secretValues(creds: BrokerCredentials | undefined): string[] {
  if (creds === undefined) return [];
  const values = [creds.accessToken.reveal()];
  if (creds.refreshToken !== undefined) values.push(creds.refreshToken.reveal());
  for (const secret of Object.values(creds.extra ?? {})) values.push(secret.reveal());
  return values;
}

/** The vault's plaintext form of {@link BrokerCredentials} (encrypted at rest by the api). Strict: no unknown keys. */
export const BrokerCredentialsJsonSchema = z.strictObject({
  accessToken: z.string().min(1).max(4096),
  refreshToken: z.string().min(1).max(4096).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  clientId: z.string().min(1).max(64).optional(),
  extra: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/), z.string().min(1).max(4096)).optional(),
});
export type BrokerCredentialsJson = z.infer<typeof BrokerCredentialsJsonSchema>;

/**
 * Reads the vault's plaintext into {@link BrokerCredentials}.
 *
 * @throws {TypeError} when the value doesn't match {@link BrokerCredentialsJsonSchema}. The message names the fields,
 *   never their values.
 */
export function credentialsFromJson(value: unknown): BrokerCredentials {
  const parsed = BrokerCredentialsJsonSchema.safeParse(value);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(root)"))].join(", ");
    throw new TypeError(`Invalid broker credentials: ${fields}`);
  }
  const json = parsed.data;
  return {
    accessToken: Secret.of(json.accessToken),
    ...(json.refreshToken === undefined ? {} : { refreshToken: Secret.of(json.refreshToken) }),
    ...(json.expiresAt === undefined ? {} : { expiresAt: new Date(json.expiresAt) }),
    ...(json.clientId === undefined ? {} : { clientId: json.clientId }),
    ...(json.extra === undefined
      ? {}
      : { extra: Object.fromEntries(Object.entries(json.extra).map(([key, secret]) => [key, Secret.of(secret)])) }),
  };
}

/** The vault's plaintext form: reveals every secret. Only `BrokerVaultService` calls it, right before encrypting. */
export function credentialsToJson(creds: BrokerCredentials): BrokerCredentialsJson {
  return {
    accessToken: creds.accessToken.reveal(),
    ...(creds.refreshToken === undefined ? {} : { refreshToken: creds.refreshToken.reveal() }),
    ...(creds.expiresAt === undefined ? {} : { expiresAt: creds.expiresAt.toISOString() }),
    ...(creds.clientId === undefined ? {} : { clientId: creds.clientId }),
    ...(creds.extra === undefined
      ? {}
      : { extra: Object.fromEntries(Object.entries(creds.extra).map(([key, secret]) => [key, secret.reveal()])) }),
  };
}
