/**
 * The request-path Redis client (plan D6): one ioredis 6 connection for rate limits, idempotency and readiness. Later
 * consumers (BullMQ, the Socket.IO adapter, the market feed) get connections of their own.
 *
 * - Fail fast: no offline queue, one retry per command, 2 s connect and 1 s command timeouts. A request fails within
 *   about a second when Redis is down instead of waiting in a queue.
 * - Reconnects forever with capped, jittered backoff (100 ms doubling to 5 s), and on READONLY (a failover).
 * - An `error` listener is always attached (without one an `error` event crashes the process) and logs at most once
 *   every 10 s, without command arguments (the err serializer drops them).
 * - Startup connects with a 3 s bound but doesn't block boot: readiness reports the state.
 * - Shutdown (LifecycleService): QUIT with a 2 s bound, then disconnect.
 * - RESP3 (ioredis 6's default) stays: the api's replies are the same in RESP2 and RESP3.
 * - Lua scripts run through `defineCommand` ({@link RedisService.defineScript}): EVALSHA, with ioredis sending the
 *   script itself once per connection when Redis doesn't know it yet (NOSCRIPT).
 */
import { Injectable } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { withTimeout } from "../../common/async";
import type { Env } from "../../config/env.schema";

/** Client options (exported for the unit test). */
export const REDIS_CLIENT_OPTIONS = Object.freeze({
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 2_000,
  commandTimeout: 1_000,
  connectionName: "finlytics-api",
});

const STARTUP_CONNECT_BOUND_MS = 3_000;
const QUIT_BOUND_MS = 2_000;
const ERROR_LOG_INTERVAL_MS = 10_000;

/** Reconnect delay for the n-th attempt (1-based): 100 ms doubling to 5 s, with jitter in its upper half. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(5_000, 100 * 2 ** Math.min(Math.max(attempt - 1, 0), 6));
  return Math.round(base / 2 + random() * (base / 2));
}

/** Reconnect (and drop the connection) when a replica answers READONLY after a failover. */
export function reconnectOnError(error: Error): boolean {
  return error.message.startsWith("READONLY");
}

/** A Lua script for {@link RedisService.defineScript}. Every key it touches is in KEYS (built by keys.ts). */
export interface RedisScriptDefinition {
  /** The client method ioredis defines for it: unique per script, camelCase. */
  readonly name: string;
  readonly numberOfKeys: number;
  readonly lua: string;
}

/** Runs a defined script: `keys` become KEYS, `args` become ARGV. Resolves to the script's raw reply. */
export type RedisScript = (keys: readonly string[], args: readonly (string | number)[]) => Promise<unknown>;

const SCRIPT_NAME = /^[a-z][A-Za-z0-9]*$/;

@Injectable()
export class RedisService implements OnModuleInit {
  readonly client: Redis;
  private lastErrorLogAt = Number.NEGATIVE_INFINITY;
  private closing: Promise<void> | undefined;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RedisService.name);
    this.client = new Redis(config.get("REDIS_URL", { infer: true }), {
      ...REDIS_CLIENT_OPTIONS,
      retryStrategy: (attempt) => reconnectDelayMs(attempt),
      reconnectOnError,
    });
    this.client.on("error", (error: unknown) => {
      this.logConnectionError(error);
    });
  }

  /** Connects with a bounded wait; a failure is logged and retried in the background, never thrown. */
  async onModuleInit(): Promise<void> {
    try {
      await withTimeout(this.client.connect(), STARTUP_CONNECT_BOUND_MS, "redis connect");
    } catch (error: unknown) {
      this.logger.warn({ err: error }, "redis not reachable at startup; reconnecting in the background");
    }
  }

  /** PING within `timeoutMs`: true when Redis answered. */
  async ping(timeoutMs: number): Promise<boolean> {
    try {
      await withTimeout(this.client.ping(), timeoutMs, "redis ping");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Defines a Lua script on the client (`defineCommand`) and returns a typed runner for it. The reply is `unknown`:
   * callers validate its shape.
   *
   * @throws {TypeError} for a name that isn't camelCase, or that the client already has, as itself or with ioredis's
   *   `Buffer` suffix: `defineCommand` would silently replace a client method (`get`, `quit`) or an earlier script.
   */
  defineScript(definition: RedisScriptDefinition): RedisScript {
    if (!SCRIPT_NAME.test(definition.name)) throw new TypeError(`Invalid Redis script name: ${definition.name}`);
    if (definition.name in this.client || `${definition.name}Buffer` in this.client) {
      throw new TypeError(`Redis script name ${definition.name} is already taken on the client`);
    }
    this.client.defineCommand(definition.name, { lua: definition.lua, numberOfKeys: definition.numberOfKeys });
    const command: unknown = Reflect.get(this.client, definition.name);
    if (typeof command !== "function") throw new TypeError(`Redis script ${definition.name} was not defined`);
    const run = command as (...args: (string | number)[]) => Promise<unknown>;
    return (keys, args) => {
      if (keys.length !== definition.numberOfKeys) {
        return Promise.reject(
          new TypeError(`Redis script ${definition.name} takes ${String(definition.numberOfKeys)} keys`),
        );
      }
      return run.apply(this.client, [...keys, ...args]);
    };
  }

  /** QUIT with a bound, then disconnect. Idempotent. */
  close(): Promise<void> {
    this.closing ??= this.quit();
    return this.closing;
  }

  private async quit(): Promise<void> {
    try {
      if (this.client.status === "ready") await withTimeout(this.client.quit(), QUIT_BOUND_MS, "redis quit");
    } catch (error: unknown) {
      this.logger.warn({ err: error }, "redis quit failed; disconnecting");
    } finally {
      this.client.disconnect();
    }
  }

  private logConnectionError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLogAt = now;
    this.logger.warn({ err: error }, "redis connection error");
  }
}
