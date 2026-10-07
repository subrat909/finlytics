/**
 * The api's entry point (plan D2): validate the environment before anything else, then start the process roles.
 *
 * An invalid environment prints one `VARIABLE: reason` line per problem to stderr (never a value) and exits 1. A
 * failed start (an unsafe production database role, a port in use) is logged without secrets and exits 1.
 */
import "reflect-metadata";

import { startRoles } from "./bootstrap/http-app";
import { serializeError } from "./common/logger/serializers";
import { EnvError, loadEnv } from "./config/env";
import type { Env } from "./config/env.schema";

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

  // APP_ROLE is a comma list (phase 1 plan P1): `http` and `gateway` share one server; `feed` and `worker` alone run
  // without one. Development runs all four in one process, production one per process.
  await startRoles(env);
}

main().catch((error: unknown) => {
  // Before (or instead of) the app's logger: one JSON line, through the same allowlisting error serializer.
  process.stderr.write(`${JSON.stringify({ level: "fatal", msg: "startup failed", err: serializeError(error) })}\n`);
  process.exit(1);
});
