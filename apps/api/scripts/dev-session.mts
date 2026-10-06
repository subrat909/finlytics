/**
 * Development only (plan §3, PR6): creates a user (or reuses one) and a session in the LOCAL database and prints the
 * session cookie, to try the api by hand before 0.6 builds sign-in.
 *
 *   NODE_ENV=development node apps/api/scripts/dev-session.mts you@example.com
 *   curl -i --cookie "authjs.session-token=<token>" http://127.0.0.1:4000/v1/me
 *
 * - Refuses to run unless NODE_ENV is exactly `development` (an unset NODE_ENV is refused too) and DATABASE_URL points
 *   at localhost, 127.0.0.1 or [::1] with no `host`, `hostaddr` or `port` query parameter (pg lets those override the
 *   URL's host, so `postgresql://u:p@localhost/db?host=db.prod.internal` would reach another server).
 * - Loads the repo-root .env for DATABASE_URL (and NODE_ENV) when DATABASE_URL isn't set, like `pnpm dev`; a variable
 *   already set in the environment wins over .env.
 * - Writes the session the way 0.6's Auth.js adapter will: the row holds SHA-256(token), never the token; it expires
 *   after the idle limit (7 days).
 * - Runs with Node 24's type stripping: no build step.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPrismaClient } from "@finlytics/database";
import { SESSION_COOKIE_NAME, SESSION_LIMITS } from "@finlytics/shared";

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Connection-string parameters with which pg (pg-connection-string) overrides the URL's own host or port. */
const HOST_OVERRIDING_PARAMETERS = ["host", "hostaddr", "port"] as const;
const DAY_MS = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why the script must not run against `env`, or undefined when it may. Never echoes the URL (it has a password). */
export function devSessionProblem(env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (env["NODE_ENV"] !== "development") return "refusing to run: NODE_ENV must be development";
  const url = env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") return "DATABASE_URL is not set";
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "DATABASE_URL is not a URL";
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) return "refusing to run: DATABASE_URL must point at localhost or 127.0.0.1";
  // Parameter names are matched case-insensitively, a stricter reading than pg's.
  const parameters = new Set([...parsed.searchParams.keys()].map((name) => name.toLowerCase()));
  if (HOST_OVERRIDING_PARAMETERS.some((name) => parameters.has(name))) {
    return "refusing to run: DATABASE_URL must not set host, hostaddr or port as query parameters";
  }
  return undefined;
}

async function main(args: readonly string[]): Promise<number> {
  const email = args[0]?.trim().toLowerCase() ?? "";
  if (!EMAIL.test(email)) {
    process.stderr.write("usage: NODE_ENV=development node apps/api/scripts/dev-session.mts <email>\n");
    return 2;
  }

  const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
  if ((process.env["DATABASE_URL"] ?? "") === "" && existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const problem = devSessionProblem(process.env);
  if (problem !== undefined) {
    process.stderr.write(`dev-session: ${problem}\n`);
    return 1;
  }

  const prisma = createPrismaClient({ url: process.env["DATABASE_URL"] ?? "", poolMax: 1 });
  try {
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name: email.split("@")[0] ?? null },
      update: {},
      select: { id: true, deletedAt: true },
    });
    if (user.deletedAt !== null) {
      process.stderr.write("dev-session: that user is deleted\n");
      return 1;
    }
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: createHash("sha256").update(token, "utf8").digest("hex"),
        expires: new Date(now.getTime() + SESSION_LIMITS.idleDays * DAY_MS),
        lastSeenAt: now,
        createdAt: now,
      },
    });
    const cookie = `${SESSION_COOKIE_NAME.development}=${token}`;
    process.stdout.write(
      `${cookie}\n\n  curl -i --cookie "${cookie}" http://127.0.0.1:4000/v1/me\n\n` +
        `Session for ${email} (user ${user.id}), valid for ${String(SESSION_LIMITS.idleDays)} days.\n`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`dev-session: ${error instanceof Error ? error.name : "error"}\n`);
      process.exitCode = 1;
    },
  );
}
