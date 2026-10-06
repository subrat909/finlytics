/**
 * Building and starting the HTTP app (plan D2). main.ts and the integration tests call the same functions, so the
 * tests exercise the production configuration.
 */
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule } from "../app.module";
import type { AppModuleOptions } from "../app.module";
import { ProblemDetailsFilter } from "../common/filters/problem-details.filter";
import type { Env } from "../config/env.schema";
import { DatabaseRoleCheck } from "../infra/prisma/database-role.check";

import { fastifyOptions, requestDeadlineMs } from "./fastify-options";
import type { FastifyOptionsOverrides } from "./fastify-options";
import { applyHttpHardening } from "./http-hardening";
import { setupOpenApi } from "./openapi";

export interface HttpAppOptions extends AppModuleOptions, FastifyOptionsOverrides {}

/** How long a production boot waits for the database before the role check gives up. */
const ROLE_CHECK_RETRY_MS = 30_000;

/**
 * Applies the logger, the exception filter, the HTTP hardening and (when API_DOCS_ENABLED) the OpenAPI docs. Call
 * before `init()` or `listen()`.
 */
export async function configureHttpApp(
  app: NestFastifyApplication,
  env: Env,
  overrides: FastifyOptionsOverrides = {},
): Promise<void> {
  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.useGlobalFilters(app.get(ProblemDetailsFilter));
  await applyHttpHardening(app, env, requestDeadlineMs(overrides));
  setupOpenApi(app, env);
}

/**
 * Creates the configured, not yet initialised HTTP app. Nest's body parsers are off (JSON only, through Fastify's own
 * parser), logs are buffered until the pino logger is in place, and a DI failure throws instead of aborting.
 */
export async function createHttpApp(env: Env, options: HttpAppOptions = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter(fastifyOptions(env));
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env, options), adapter, {
    bodyParser: false,
    bufferLogs: true,
    abortOnError: false,
  });
  await configureHttpApp(app, env, options);
  return app;
}

/**
 * The `http` role: build the app, enable the ordered shutdown on SIGTERM/SIGINT (exit 0), run the database role check
 * (production: refuse an unsafe role; elsewhere: warn) and listen.
 */
export async function startHttp(env: Env): Promise<NestFastifyApplication> {
  const app = await createHttpApp(env);
  app.enableShutdownHooks([], { useProcessExit: true });

  const roleCheck = app.get(DatabaseRoleCheck);
  if (env.NODE_ENV === "production") {
    await roleCheck.enforce({ retryForMs: ROLE_CHECK_RETRY_MS });
  } else {
    await roleCheck.warnIfUnsafe();
  }

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.get(Logger).log(`listening on ${await app.getUrl()}`, "Bootstrap");
  return app;
}
