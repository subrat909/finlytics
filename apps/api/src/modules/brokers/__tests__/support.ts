/** Shared fixtures for the brokers unit tests: a real VaultService and gateways over fake adapters. */
import { MemoryRateLimiter } from "@finlytics/broker-sdk";
import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import { vi } from "vitest";

import { fakeRegistry } from "../../../../test/support/fake-broker";
import type { FakeBrokerScript } from "../../../../test/support/fake-broker";
import type { RequestMetadata } from "../../../common/decorators/request-meta";
import type { Env } from "../../../config/env.schema";
import { VaultService } from "../../../infra/vault/vault.service";
import { BrokerGateways } from "../broker-gateways";

export const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

export const REQUEST: RequestMetadata = {
  requestId: "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f",
  ip: "203.0.113.7",
  userAgent: "vitest",
};

export function logger(): PinoLogger {
  return { setContext: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
}

export function config(values: Partial<Record<keyof Env, unknown>> = {}): ConfigService<Env, true> {
  const all: Record<string, unknown> = {
    MASTER_KEY,
    API_PUBLIC_URL: "http://localhost:3000",
    NODE_ENV: "test",
    ...values,
  };
  return { get: (name: string) => all[name] } as unknown as ConfigService<Env, true>;
}

export function vault(masterKey: string | undefined = MASTER_KEY): VaultService {
  return new VaultService(config({ MASTER_KEY: masterKey }), logger());
}

export const SCRIPTS = {
  UPSTOX: { authMode: "oauth", validCode: "good-code", clientId: "UPX42" },
  DHAN: { authMode: "token", validToken: "dhan-token-0123456789" },
  PAPER: { authMode: "none", clientId: "PAPER-1" },
} as const satisfies Partial<Record<string, FakeBrokerScript>>;

export function gateways(scripts: Parameters<typeof fakeRegistry>[0] = SCRIPTS) {
  const { registry, log } = fakeRegistry(scripts);
  return { gateways: new BrokerGateways(registry, new MemoryRateLimiter(), logger()), log };
}
