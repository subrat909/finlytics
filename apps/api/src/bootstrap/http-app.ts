/**
 * Building and starting the HTTP app (plan D2). main.ts and the integration tests call the same functions, so the
 * tests exercise the production configuration.
 */
import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule } from "../app.module";
import type { AppModuleOptions } from "../app.module";
import { ProblemDetailsFilter } from "../common/filters/problem-details.filter";
import { hasRole } from "../config/env.schema";
import type { Env } from "../config/env.schema";
import { DatabaseRoleCheck } from "../infra/prisma/database-role.check";
import { RealtimeIoAdapter } from "../modules/realtime/realtime-io.adapter";

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
  // The `gateway` role: Socket.IO `/rt` on this same HTTP server (installed before init, which binds gateways).
  if (hasRole(env, "gateway")) app.useWebSocketAdapter(new RealtimeIoAdapter(app, env));
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

/** The database role check: production refuses an unsafe role, elsewhere it warns. */
async function checkDatabaseRole(app: INestApplicationContext, env: Env): Promise<void> {
  const roleCheck = app.get(DatabaseRoleCheck);
  if (env.NODE_ENV === "production") {
    await roleCheck.enforce({ retryForMs: ROLE_CHECK_RETRY_MS });
  } else {
    await roleCheck.warnIfUnsafe();
  }
}

/**
 * The `http` and/or `gateway` roles (with any others the process also runs): build the app, enable the ordered
 * shutdown on SIGTERM/SIGINT (exit 0), run the database role check and listen. REST and Socket.IO share the server.
 */
export async function startHttp(env: Env): Promise<NestFastifyApplication> {
  const app = await createHttpApp(env);
  app.enableShutdownHooks([], { useProcessExit: true });
  await checkDatabaseRole(app, env);

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.get(Logger).log(`listening on ${await app.getUrl()} as ${env.APP_ROLE.join(",")}`, "Bootstrap");
  return app;
}

/** The roles without a server (`feed`, `worker`): an application context, started and kept alive by its timers. */
export async function startContext(env: Env): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(env), {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.enableShutdownHooks([], { useProcessExit: true });
  await checkDatabaseRole(app, env);
  await app.init();
  app.get(Logger).log(`started as ${env.APP_ROLE.join(",")}`, "Bootstrap");
  return app;
}

/** Starts the process roles in APP_ROLE: one server when `http` or `gateway` is among them, else a context. */
export function startRoles(env: Env): Promise<INestApplicationContext> {
  return hasRole(env, "http") || hasRole(env, "gateway") ? startHttp(env) : startContext(env);
}
