/**
 * Test apps whose BrokerRegistry holds fake adapters (test/support/fake-broker.ts): the production bootstrap
 * (configureHttpApp: Fastify options, hardening, filter, global enhancers) on a Nest testing module, so the registry
 * provider can be overridden. Everything after the registry (BrokerGateway, rate limiter, vault, database, Redis) is
 * real.
 */
import type { DynamicModule, Type } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";

import { AppModule } from "../../src/app.module";
import { configureHttpApp } from "../../src/bootstrap/http-app";
import { fastifyOptions } from "../../src/bootstrap/fastify-options";
import { BROKER_REGISTRY } from "../../src/modules/brokers/broker-gateways";
import { fakeRegistry } from "../support/fake-broker";
import type { FakeBrokerLog, FakeBrokerScript } from "../support/fake-broker";

import { testEnv } from "./app";
import type { TestApp } from "./app";
import { logCapture } from "./log-capture";

export const TEST_MASTER_KEY = Buffer.alloc(32, 42).toString("base64");

export const FAKE_SCRIPTS = {
  UPSTOX: { authMode: "oauth", validCode: "good-code", clientId: "UPX42" },
  DHAN: { authMode: "token", validToken: "dhan-token-0123456789" },
  PAPER: { authMode: "none", clientId: "PAPER-1" },
} as const satisfies Partial<Record<string, FakeBrokerScript>>;

export interface BrokerTestApp extends TestApp {
  readonly log: FakeBrokerLog;
}

export async function createBrokerTestApp(
  scripts: Parameters<typeof fakeRegistry>[0] = FAKE_SCRIPTS,
  extraImports: readonly (Type | DynamicModule)[] = [],
): Promise<BrokerTestApp> {
  const env = testEnv({ MASTER_KEY: TEST_MASTER_KEY, API_PUBLIC_URL: "http://localhost:3000" });
  const { registry, log } = fakeRegistry(scripts);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env, { logDestination: logCapture, extraImports })],
  })
    .overrideProvider(BROKER_REGISTRY)
    .useValue(registry)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(fastifyOptions(env)), {
    bodyParser: false,
    bufferLogs: true,
  });
  await configureHttpApp(app, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, env, log, request: (options) => app.inject(options), close: () => app.close() };
}
