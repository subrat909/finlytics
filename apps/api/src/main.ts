/**
 * The api's entry point (plan D2): validate the environment before anything else, then start the process role.
 *
 * An invalid environment prints one `VARIABLE: reason` line per problem to stderr (never a value) and exits 1. A
 * failed start (an unsafe production database role, a port in use) is logged without secrets and exits 1.
 */
import "reflect-metadata";

import { startHttp } from "./bootstrap/http-app";
import { serializeError } from "./common/logger/serializers";
import { EnvError, loadEnv } from "./config/env";
import type { AppRole, Env } from "./config/env.schema";

/** What each process role starts. 1.4 adds `gateway` and `feed`. */
const ROLES: Readonly<Record<AppRole, (env: Env) => Promise<unknown>>> = { http: startHttp };

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv(process.env);
  } catch (error: unknown) {
    if (!(error instanceof EnvError)) throw error;
    process.stderr.write(`Invalid environment:\n${error.issues.map((issue) => `  ${issue}\n`).join("")}`);
    process.exitCode = 1;
    return;
  }

  await ROLES[env.APP_ROLE](env);
}

main().catch((error: unknown) => {
  // Before (or instead of) the app's logger: one JSON line, through the same allowlisting error serializer.
  process.stderr.write(`${JSON.stringify({ level: "fatal", msg: "startup failed", err: serializeError(error) })}\n`);
  process.exit(1);
});
