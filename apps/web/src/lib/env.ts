/**
 * The web app's server environment (plan W2), validated with Zod. Server-only: never import it from a client component.
 *
 * `next.config.ts` imports this file natively (Node's type stripping), so it uses only erasable TypeScript syntax and
 * imports nothing relative. It validates at startup (`next dev`, `next start`) and prints one `VARIABLE: reason` line
 * per problem, never a value. Everything except `AUTH_SECRET` has a development default; production requires every
 * variable it uses and `https://` origins.
 */
import { z } from "zod";

export const RUNTIME_MODES = ["development", "test", "production"] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/** Development and test defaults (docker-compose: mailpit on 1025, the api on 4000). */
export const DEV_DEFAULTS = Object.freeze({
  AUTH_URL: "http://localhost:3000",
  EMAIL_SERVER: "smtp://127.0.0.1:1025",
  EMAIL_FROM: "Finlytics <no-reply@finlytics.local>",
  API_INTERNAL_URL: "http://127.0.0.1:4000",
  // The browser's realtime socket (plan 1.4): `localhost`, not 127.0.0.1, so the session cookie (set for localhost by
  // the web app) is sent; cookies ignore ports.
  RT_URL: "http://localhost:4000",
});

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface WebEnv {
  mode: RuntimeMode;
  authSecret: string;
  /** The app's public origin, e.g. `https://app.finlytics.in`; magic links point here. */
  authUrl: string;
  google: OAuthClient | undefined;
  github: OAuthClient | undefined;
  /** An `smtp://` or `smtps://` URL for nodemailer. */
  emailServer: string;
  emailFrom: string;
  /** Where the `/v1` rewrite and server-side api calls go; undefined in production when the ingress routes `/v1`. */
  apiInternalUrl: string | undefined;
  /**
   * The realtime socket's origin (`NEXT_PUBLIC_RT_URL`, plan 1.4). Undefined means the page's own origin (`/rt` through
   * the ingress, production's default). Read on the server and passed to the client, so it's runtime configuration.
   */
  rtUrl: string | undefined;
}

export class WebEnvError extends Error {
  override name = "WebEnvError";
  /** One `VARIABLE: reason` line per problem, without values. */
  issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid web environment:\n${issues.map((issue) => `  ${issue}`).join("\n")}`);
    this.issues = issues;
  }
}

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** `scheme://host[:port]` with an http(s) scheme, no credentials, path, query or fragment (a trailing `/` is fine). */
export function isHttpOrigin(value: string): boolean {
  const url = parseUrl(value);
  return (
    url !== undefined &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    !value.endsWith("?") &&
    !value.endsWith("#")
  );
}

const ORIGIN_REASON = "must be an http(s) origin (scheme://host[:port], no path)";

const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const optionalOrigin = z.preprocess(
  blankToUndefined,
  z.string().refine(isHttpOrigin, { error: ORIGIN_REASON }).optional(),
);

const RawEnvSchema = z.object({
  NODE_ENV: z.preprocess(
    blankToUndefined,
    z.enum(RUNTIME_MODES, { error: "must be development, test or production" }).default("development"),
  ),
  AUTH_SECRET: z.preprocess(
    blankToUndefined,
    z
      .string({ error: "is required (generate one: openssl rand -base64 32)" })
      .min(32, { error: "must be at least 32 characters (openssl rand -base64 32)" }),
  ),
  AUTH_URL: optionalOrigin,
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,
  AUTH_GITHUB_ID: optionalString,
  AUTH_GITHUB_SECRET: optionalString,
  EMAIL_SERVER: z.preprocess(
    blankToUndefined,
    z
      .string()
      .refine((value) => ["smtp:", "smtps:"].includes(parseUrl(value)?.protocol ?? ""), {
        error: "must be an smtp:// or smtps:// URL",
      })
      .optional(),
  ),
  EMAIL_FROM: z.preprocess(
    blankToUndefined,
    z
      .string()
      .max(200, { error: "must be at most 200 characters" })
      // A sender header: no line breaks (header injection), and an address in it.
      .refine((value) => !/[\r\n]/.test(value) && /\S+@\S+/.test(value), {
        error: 'must be an address, e.g. "Finlytics <no-reply@example.com>"',
      })
      .optional(),
  ),
  API_INTERNAL_URL: optionalOrigin,
  NEXT_PUBLIC_RT_URL: optionalOrigin,
});

type RawEnv = z.infer<typeof RawEnvSchema>;

function oauthPair(id: string | undefined, secret: string | undefined): OAuthClient | undefined {
  return id !== undefined && secret !== undefined ? { clientId: id, clientSecret: secret } : undefined;
}

function crossFieldIssues(env: RawEnv): string[] {
  const issues: string[] = [];
  const pairs = [
    ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"],
    ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"],
  ] as const;
  for (const [id, secret] of pairs) {
    if ((env[id] === undefined) !== (env[secret] === undefined)) {
      const missing = env[id] === undefined ? id : secret;
      issues.push(`${missing}: is required when ${missing === id ? secret : id} is set (set both or neither)`);
    }
  }
  if (env.NODE_ENV === "production") {
    for (const name of ["AUTH_URL", "EMAIL_SERVER", "EMAIL_FROM"] as const) {
      if (env[name] === undefined) issues.push(`${name}: is required in production`);
    }
    if (env.AUTH_URL !== undefined && !env.AUTH_URL.startsWith("https://")) {
      issues.push("AUTH_URL: must use https:// in production");
    }
  }
  return issues;
}

function stripTrailingSlash(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

/**
 * Validates an environment (pure: pass `process.env` or a test object).
 *
 * @throws {WebEnvError} listing every problem as `VARIABLE: reason`.
 */
export function parseWebEnv(source: Readonly<Record<string, string | undefined>>): WebEnv {
  const result = RawEnvSchema.safeParse(source);
  if (!result.success) {
    throw new WebEnvError(
      result.error.issues.map((issue) => `${issue.path.map(String).join(".") || "env"}: ${issue.message}`),
    );
  }
  const env = result.data;
  const issues = crossFieldIssues(env);
  if (issues.length > 0) throw new WebEnvError(issues);

  const dev = env.NODE_ENV !== "production";
  return {
    mode: env.NODE_ENV,
    authSecret: env.AUTH_SECRET,
    authUrl: stripTrailingSlash(env.AUTH_URL ?? DEV_DEFAULTS.AUTH_URL),
    google: oauthPair(env.AUTH_GOOGLE_ID, env.AUTH_GOOGLE_SECRET),
    github: oauthPair(env.AUTH_GITHUB_ID, env.AUTH_GITHUB_SECRET),
    emailServer: env.EMAIL_SERVER ?? DEV_DEFAULTS.EMAIL_SERVER,
    emailFrom: env.EMAIL_FROM ?? DEV_DEFAULTS.EMAIL_FROM,
    apiInternalUrl:
      env.API_INTERNAL_URL !== undefined
        ? stripTrailingSlash(env.API_INTERNAL_URL)
        : dev
          ? DEV_DEFAULTS.API_INTERNAL_URL
          : undefined,
    rtUrl: realtimeOriginFrom(env.NEXT_PUBLIC_RT_URL, env.NODE_ENV),
  };
}

function realtimeOriginFrom(value: string | undefined, mode: RuntimeMode): string | undefined {
  if (value !== undefined) return stripTrailingSlash(value);
  return mode === "production" ? undefined : DEV_DEFAULTS.RT_URL;
}

/**
 * The realtime origin without validating anything else (the proxy's CSP needs only this): `NEXT_PUBLIC_RT_URL` when
 * it's a valid origin, else the development default, else undefined (same origin). Startup validation reports a bad
 * value; this never throws.
 */
export function realtimeOrigin(source: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const raw = source.NEXT_PUBLIC_RT_URL?.trim();
  const value = raw !== undefined && raw !== "" && isHttpOrigin(raw) ? raw : undefined;
  return realtimeOriginFrom(value, runtimeMode(source.NODE_ENV));
}

let cached: WebEnv | undefined;

/** The validated `process.env`, parsed once per process. */
export function getWebEnv(): WebEnv {
  cached ??= parseWebEnv(process.env);
  return cached;
}

/** `NODE_ENV` without validating anything else (the proxy and the cookie name need only this). */
export function runtimeMode(nodeEnv: string | undefined = process.env.NODE_ENV): RuntimeMode {
  return nodeEnv === "production" || nodeEnv === "test" ? nodeEnv : "development";
}
