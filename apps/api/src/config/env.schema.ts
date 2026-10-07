/**
 * The api's environment (plan D3, docs/04 §7): one Zod schema for every variable the api reads, the database
 * package's included. main.ts validates `process.env` with it before Nest starts; everything else reads the result
 * through ConfigService<Env, true>.
 *
 * Messages are reasons only: an issue prints as `VARIABLE: reason`, never with the value (DATABASE_URL and REDIS_URL
 * carry passwords). Defaults that depend on NODE_ENV are applied after validation, so a production rule can tell an
 * explicit setting from a missing one.
 */
import { isIP } from "node:net";

import { checkDatabaseEnv, databaseEnvShape } from "@finlytics/database";
import { z } from "zod";

/**
 * Fixed in code, not configurable (plan D3 notes, D11): the body limit, the 15 s budget for the whole request
 * lifecycle (Fastify `handlerTimeout`) and for receiving the request, and the keep-alive timeout.
 */
export const HTTP_LIMITS = Object.freeze({
  bodyLimitBytes: 1_048_576,
  handlerTimeoutMs: 15_000,
  requestTimeoutMs: 15_000,
  keepAliveTimeoutMs: 72_000,
} as const);

/**
 * Interactive transactions (`prisma.db.$transaction(async (tx) => …)`), fixed in code: at most 2 s waiting for a
 * connection plus 12 s running, 14 s in all, so a transaction ends inside the 15 s request budget. DB_STATEMENT_TIMEOUT_MS
 * must stay below `timeoutMs`, so PostgreSQL cancels a slow statement before Prisma gives up on its transaction.
 */
export const TRANSACTION_LIMITS = Object.freeze({
  maxWaitMs: 2_000,
  timeoutMs: 12_000,
} as const);

/** API_HOST values that accept connections from this machine only. */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * The process roles (phase 1 plan P1), as a comma list: `http` (REST), `gateway` (Socket.IO `/rt`), `feed` (the shared
 * market feed, one leader per broker) and `worker` (BullMQ processors). Development runs all four in one process;
 * production runs one role per process.
 */
export const APP_ROLES = ["http", "gateway", "feed", "worker"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/**
 * Where the shared market feed comes from (plan P2; phase-1b "Feed source"): `auto` (development default) drives it
 * from the best ACTIVE broker account and falls back to the deterministic simulator; `paper` is the simulator only;
 * `upstox` and `dhan` use the BrokerAccount in MARKET_FEED_ACCOUNT_ID (production requires one of these two).
 */
export const MARKET_FEED_SOURCES = ["auto", "paper", "upstox", "dhan"] as const;
export type MarketFeedSource = (typeof MARKET_FEED_SOURCES)[number];

/** The sources that name one broker account (MARKET_FEED_ACCOUNT_ID). */
export const BROKER_FEED_SOURCES: readonly MarketFeedSource[] = Object.freeze(["upstox", "dhan"]);

const APP_ROLE_REASON = `must be a comma-separated list of ${APP_ROLES.join(", ")}`;

/** `http,gateway` → `["http", "gateway"]`: known roles only, each once, in {@link APP_ROLES} order. */
const appRoleVariable = z.string({ error: APP_ROLE_REASON }).transform((raw, ctx): readonly AppRole[] => {
  const names = raw.split(",").map((entry) => entry.trim());
  if (names.some((name) => !(APP_ROLES as readonly string[]).includes(name))) {
    ctx.addIssue({ code: "custom", message: APP_ROLE_REASON });
    return z.NEVER;
  }
  return Object.freeze(APP_ROLES.filter((role) => names.includes(role)));
});

/** Whether the process runs `role`. */
export function hasRole(env: Pick<Env, "APP_ROLE">, role: AppRole): boolean {
  return env.APP_ROLE.includes(role);
}

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_FORMATS = ["json", "pretty"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** The origin the web app runs on in development (Next.js on :3000). */
const DEVELOPMENT_ORIGIN = "http://localhost:3000";

/** How long readiness answers `draining` before the server stops accepting connections, in production. */
const PRODUCTION_DRAIN_MS = 5_000;

/**
 * Which proxies may set X-Forwarded-For (Fastify `trustProxy`): `false` (none: the client is the TCP peer) or the
 * proxies' addresses (IPs and CIDRs). Fastify uses the rightmost address that isn't a trusted proxy.
 *
 * Never `true`, which would let any client choose its own IP. Never a hop count either: Fastify >= 5.12.2 treats a
 * numeric `trustProxy` as "trust nothing", because a hop count can't verify that the immediate peer is a proxy, so a
 * client that reaches the api directly could spoof X-Forwarded-For.
 */
export type TrustProxy = false | readonly string[];

/** An unset variable and an empty one (`API_PORT=` in a .env file) both mean "not set". */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

/** An optional variable: `schema` when set, `undefined` when unset or empty. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(emptyToUndefined, schema.optional());
}

/** An integer from `min` to `max`, decimal digits only (`Number()` would also read "1e3", "0x10" and " "). */
function integer(min: number, max: number) {
  const reason = `must be an integer from ${String(min)} to ${String(max)}`;
  return z
    .string({ error: reason })
    .trim()
    .regex(/^\d+$/, reason)
    .transform(Number)
    .pipe(z.int({ error: reason }).min(min, reason).max(max, reason));
}

/** `true` or `false`, exactly. Never z.coerce.boolean(), which reads "false" as true. */
const booleanVariable = z.stringbool({
  truthy: ["true"],
  falsy: ["false"],
  case: "sensitive",
  error: "must be true or false",
});

/** RFC 1123 host names: dot-separated labels of letters, digits and inner hyphens, at most 253 characters. */
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** Whether `host` is an IP address or an RFC 1123 host name. */
function isHost(host: string): boolean {
  return isIP(host) !== 0 || HOSTNAME.test(host);
}

const hostVariable = z
  .string({ error: "must be an IP address or a host name" })
  .trim()
  .refine(isHost, "must be an IP address or a host name");

const redisUrlVariable = z
  .string({ error: "is required" })
  .trim()
  .min(1, "must not be empty")
  .refine((value) => {
    try {
      const { protocol, hostname } = new URL(value);
      return (protocol === "redis:" || protocol === "rediss:") && hostname !== "";
    } catch {
      return false;
    }
  }, "must be a redis:// or rediss:// URL");

/** Whether `value` is an IP address or a CIDR range (`10.0.0.0/8`, `fd00::/8`). */
function isIpOrCidr(value: string): boolean {
  const [address = "", prefix, ...rest] = value.split("/");
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

const TRUST_PROXY_REASON = "must be false or the proxies' comma-separated IPs/CIDRs";

const trustProxyVariable = z.string({ error: TRUST_PROXY_REASON }).transform((raw, ctx): TrustProxy => {
  const value = raw.trim();
  if (value === "false") return false;
  if (value === "true") {
    ctx.addIssue({
      code: "custom",
      message: "must not be true: any client could then set its own IP through X-Forwarded-For",
    });
    return z.NEVER;
  }
  if (/^\d+$/.test(value)) {
    ctx.addIssue({
      code: "custom",
      message:
        "must list the proxies' IPs/CIDRs, not a hop count: a hop count can't verify the immediate peer, and " +
        "Fastify >= 5.12.2 ignores it",
    });
    return z.NEVER;
  }
  const addresses = value.split(",").map((entry) => entry.trim());
  if (addresses.some((entry) => !isIpOrCidr(entry))) {
    ctx.addIssue({ code: "custom", message: TRUST_PROXY_REASON });
    return z.NEVER;
  }
  return Object.freeze([...new Set(addresses)]);
});

const ORIGINS_REASON = "must be comma-separated origins (scheme://host[:port], no path, no wildcard)";

/** A browser origin exactly as browsers send it: `http(s)://host[:port]`, lowercase, no default port, no path. */
function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

const originsVariable = z.string({ error: ORIGINS_REASON }).transform((raw, ctx): readonly string[] => {
  const origins = raw.split(",").map((entry) => entry.trim());
  if (origins.some((origin) => origin.includes("*"))) {
    ctx.addIssue({ code: "custom", message: "must list exact origins: a wildcard would allow any site" });
    return z.NEVER;
  }
  if (origins.some((origin) => !isExactOrigin(origin))) {
    ctx.addIssue({ code: "custom", message: ORIGINS_REASON });
    return z.NEVER;
  }
  return Object.freeze([...new Set(origins)]);
});

const MASTER_KEY_REASON = "must be 32 bytes, base64-encoded (openssl rand -base64 32)";

/**
 * The vault's master key (plan P3, docs/06 "Crypto design"): exactly 32 bytes as standard base64. Kept as the string;
 * VaultService decodes it. Required in production; elsewhere, unset means an ephemeral key per process (a warning).
 */
const masterKeyVariable = z
  .string({ error: MASTER_KEY_REASON })
  .trim()
  .refine(
    (value) => /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, "base64").length === 32,
    MASTER_KEY_REASON,
  );

const PUBLIC_URL_REASON = "must be an http(s) origin (scheme://host[:port], no path)";

/** The public origin of the web app and `/v1` (same origin): broker OAuth redirect URIs and post-login redirects. */
const publicUrlVariable = z
  .string({ error: PUBLIC_URL_REASON })
  .trim()
  .transform((value) => value.replace(/\/+$/, ""))
  .refine(isExactOrigin, PUBLIC_URL_REASON);

/** The api's own variables. Variables with a NODE_ENV-dependent default parse to `undefined` when unset. */
const apiEnvShape = {
  APP_ROLE: z.preprocess(emptyToUndefined, appRoleVariable.default(Object.freeze(["http"] as const))),
  API_HOST: z.preprocess(emptyToUndefined, hostVariable.default("127.0.0.1")),
  API_PORT: z.preprocess(emptyToUndefined, integer(0, 65_535).default(4_000)),
  REDIS_URL: redisUrlVariable,
  API_LOG_LEVEL: optional(z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(", ")}` })),
  API_LOG_FORMAT: optional(z.enum(LOG_FORMATS, { error: "must be json or pretty" })),
  API_TRUST_PROXY: optional(trustProxyVariable),
  API_ALLOWED_ORIGINS: optional(originsVariable),
  API_DOCS_ENABLED: optional(booleanVariable),
  API_SHUTDOWN_DRAIN_MS: optional(integer(0, 30_000)),
  API_RATE_LIMIT_PUBLIC_PER_MIN: z.preprocess(emptyToUndefined, integer(1, 100_000).default(100)),
  API_RATE_LIMIT_USER_PER_MIN: z.preprocess(emptyToUndefined, integer(1, 100_000).default(600)),
  MASTER_KEY: optional(masterKeyVariable),
  API_PUBLIC_URL: optional(publicUrlVariable),
  MARKET_FEED_SOURCE: optional(z.enum(MARKET_FEED_SOURCES, { error: "must be auto, paper, upstox or dhan" })),
  MARKET_FEED_ACCOUNT_ID: optional(
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "must be a BrokerAccount id"),
  ),
  MARKET_FEED_ALWAYS_ON: optional(booleanVariable),
  MARKET_FEED_PAPER_SEED: z.preprocess(emptyToUndefined, integer(0, 2_147_483_647).default(1)),
  MARKET_FEED_PAPER_TICK_MS: z.preprocess(emptyToUndefined, integer(20, 60_000).default(250)),
  RT_UNSUB_GRACE_MS: z.preprocess(emptyToUndefined, integer(0, 600_000).default(30_000)),
};

/** What {@link checkApiEnv} reads: possibly unparsed values, since it also runs when another variable failed. */
type ApiEnvRuleInput = Readonly<Record<string, unknown>> | null | undefined;

/**
 * Rules that span variables (plan D3). Tolerates unparsed values (it runs with `when: () => true`, alongside every
 * field's own issue) and checks only values that parsed.
 *
 * - Everywhere: DB_STATEMENT_TIMEOUT_MS stays below the transaction timeout ({@link TRANSACTION_LIMITS}).
 * - Production: settings that would silently weaken security become boot failures.
 */
export function checkApiEnv(env: ApiEnvRuleInput, ctx: z.RefinementCtx): void {
  const issue = (variable: string, message: string): void => {
    ctx.addIssue({ code: "custom", path: [variable], message });
  };

  // A value outside the variable's own range already has its issue (and may still reach here as a number).
  const hasOwnIssue = (variable: string): boolean => ctx.issues.some((existing) => existing.path?.[0] === variable);

  const statementTimeout = env?.["DB_STATEMENT_TIMEOUT_MS"];
  if (
    typeof statementTimeout === "number" &&
    statementTimeout >= TRANSACTION_LIMITS.timeoutMs &&
    !hasOwnIssue("DB_STATEMENT_TIMEOUT_MS")
  ) {
    issue(
      "DB_STATEMENT_TIMEOUT_MS",
      `must be below the ${String(TRANSACTION_LIMITS.timeoutMs)} ms transaction timeout`,
    );
  }

  const roles = Array.isArray(env?.["APP_ROLE"]) ? (env["APP_ROLE"] as readonly string[]) : [];
  const feedSource = env?.["MARKET_FEED_SOURCE"];
  if (
    typeof feedSource === "string" &&
    BROKER_FEED_SOURCES.includes(feedSource as MarketFeedSource) &&
    roles.includes("feed") &&
    env?.["MARKET_FEED_ACCOUNT_ID"] === undefined
  ) {
    issue("MARKET_FEED_ACCOUNT_ID", `is required when MARKET_FEED_SOURCE is ${feedSource} and APP_ROLE includes feed`);
  }

  if (env?.["NODE_ENV"] !== "production") return;

  if (roles.length > 1) issue("APP_ROLE", "must name one role per process in production");
  if (feedSource === "auto" || feedSource === "paper") {
    issue("MARKET_FEED_SOURCE", "must be upstox or dhan in production: never simulated or picked from user accounts");
  } else if (feedSource === undefined && (roles.includes("feed") || roles.includes("gateway"))) {
    issue("MARKET_FEED_SOURCE", "must be set in production when APP_ROLE is feed or gateway");
  }

  if (env["API_TRUST_PROXY"] === undefined) {
    issue("API_TRUST_PROXY", "must be set explicitly in production: false or the proxies' IPs/CIDRs");
  }
  const origins = env["API_ALLOWED_ORIGINS"];
  if (origins === undefined) {
    issue("API_ALLOWED_ORIGINS", "is required in production");
  } else if (Array.isArray(origins) && origins.some((origin) => !String(origin).startsWith("https://"))) {
    issue("API_ALLOWED_ORIGINS", "must list https:// origins only in production");
  }
  if (env["API_LOG_FORMAT"] === "pretty") issue("API_LOG_FORMAT", "must be json in production");
  const level = env["API_LOG_LEVEL"];
  if (level === "trace" || level === "silent") issue("API_LOG_LEVEL", "must not be trace or silent in production");
  if (env["API_DOCS_ENABLED"] === true) issue("API_DOCS_ENABLED", "must be false in production");
  if (env["API_PORT"] === 0) issue("API_PORT", "must be from 1 to 65535 in production");
  if (env["MASTER_KEY"] === undefined && !hasOwnIssue("MASTER_KEY")) {
    issue("MASTER_KEY", "is required in production");
  }
  const publicUrl = env["API_PUBLIC_URL"];
  if (publicUrl === undefined && !hasOwnIssue("API_PUBLIC_URL")) {
    issue("API_PUBLIC_URL", "is required in production");
  } else if (typeof publicUrl === "string" && !publicUrl.startsWith("https://")) {
    issue("API_PUBLIC_URL", "must use https:// in production");
  }
}

/**
 * NODE_ENV must be explicit unless the api listens on loopback. Unset (or empty), it defaults to `development`
 * (@finlytics/database's shape), which switches every production rule off: harmless on 127.0.0.1, dangerous on a
 * reachable address. Reads the RAW environment, because after parsing an unset NODE_ENV is indistinguishable from an
 * explicit `development`. An invalid API_HOST has its own issue, so it is left to that one.
 *
 * @returns the `VARIABLE: reason` line, or none.
 */
export function explicitNodeEnvIssues(source: Readonly<Record<string, unknown>>): string[] {
  const nodeEnv = source["NODE_ENV"];
  const host = source["API_HOST"];
  if (nodeEnv !== undefined && nodeEnv !== "") return [];
  if (typeof host !== "string" || host.trim() === "") return []; // the default, 127.0.0.1
  const trimmed = host.trim();
  if (!isHost(trimmed) || LOOPBACK_HOSTS.has(trimmed)) return [];
  return [
    "NODE_ENV: must be set when API_HOST is not 127.0.0.1, ::1 or localhost: unset, it defaults to development, " +
      "which turns the production rules off",
  ];
}

/** The environment schema. Parse with `loadEnv()` (src/config/env.ts), which formats issues without values. */
export const EnvSchema = z
  .object({ ...databaseEnvShape, ...apiEnvShape })
  .superRefine(
    (env, ctx) => {
      checkDatabaseEnv(env, ctx);
      checkApiEnv(env, ctx);
    },
    { when: () => true },
  )
  .transform((env) => {
    const production = env.NODE_ENV === "production";
    const resolved = {
      ...env,
      API_LOG_LEVEL: env.API_LOG_LEVEL ?? (env.NODE_ENV === "test" ? "silent" : "info"),
      API_LOG_FORMAT: env.API_LOG_FORMAT ?? (env.NODE_ENV === "development" ? "pretty" : "json"),
      API_TRUST_PROXY: env.API_TRUST_PROXY ?? false,
      API_ALLOWED_ORIGINS: env.API_ALLOWED_ORIGINS ?? Object.freeze([DEVELOPMENT_ORIGIN]),
      API_DOCS_ENABLED: env.API_DOCS_ENABLED ?? !production,
      API_SHUTDOWN_DRAIN_MS: env.API_SHUTDOWN_DRAIN_MS ?? (production ? PRODUCTION_DRAIN_MS : 0),
      API_PUBLIC_URL: env.API_PUBLIC_URL ?? DEVELOPMENT_ORIGIN,
      MARKET_FEED_SOURCE: env.MARKET_FEED_SOURCE ?? "auto",
      MARKET_FEED_ALWAYS_ON: env.MARKET_FEED_ALWAYS_ON ?? !production,
    } satisfies Record<string, unknown>;
    return Object.freeze(resolved);
  });

/** The validated, frozen environment. */
export type Env = z.output<typeof EnvSchema>;
