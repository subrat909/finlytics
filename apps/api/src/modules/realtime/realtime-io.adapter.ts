/**
 * The Socket.IO server for the `gateway` role (phase 1 plan "WebSocket"), on the same HTTP server as Fastify when the
 * process also runs `http` (Nest's IoAdapter attaches to `app.getHttpServer()`; Engine.IO answers only its own path,
 * `/rt/socket.io/`, and passes every other request on to Fastify).
 *
 * - Parser: `socket.io-msgpack-parser` (the web client uses the same).
 * - Origin: checked at the Engine.IO level (`allowRequest`), before any Socket.IO packet, and again with the session
 *   in the namespace middleware. CORS for the polling transport: the API_ALLOWED_ORIGINS allowlist with credentials.
 * - `@socket.io/redis-adapter` on two connections of its own, so rooms like `user:<id>` (2.1) reach every pod. Quote
 *   fan-out stays local to each pod (each subscribes to `q:<key>` itself).
 * - 64 KiB message cap, no client bundle served, no Socket.IO cookie.
 * - Closing never closes the shared HTTP server (Fastify does that): it disconnects the clients and the Redis adapter.
 */
import type { IncomingMessage } from "node:http";

import { RT_PATH } from "@finlytics/shared";
import type { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { Namespace, Server, ServerOptions } from "socket.io";
import * as msgpackParser from "socket.io-msgpack-parser";

import type { Env } from "../../config/env.schema";
import { reconnectDelayMs } from "../../infra/redis/redis.service";

import { isAllowedHandshakeOrigin } from "./handshake";

/** The largest message a client may send. */
const MAX_MESSAGE_BYTES = 64 * 1024;

function adapterClient(url: string, name: string): Redis {
  return new Redis(url, {
    connectionName: name,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => reconnectDelayMs(attempt),
  });
}

export class RealtimeIoAdapter extends IoAdapter {
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #redisUrl: string;
  readonly #clients: Redis[] = [];
  readonly #servers = new Set<Server>();

  constructor(app: INestApplicationContext, env: Pick<Env, "API_ALLOWED_ORIGINS" | "REDIS_URL">) {
    super(app);
    this.#allowedOrigins = new Set(env.API_ALLOWED_ORIGINS);
    this.#redisUrl = env.REDIS_URL;
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      path: RT_PATH,
      serveClient: false,
      cookie: false,
      parser: msgpackParser,
      maxHttpBufferSize: MAX_MESSAGE_BYTES,
      connectTimeout: 10_000,
      cors: { origin: [...this.#allowedOrigins], credentials: true, methods: ["GET", "POST"] },
      allowRequest: (
        request: IncomingMessage,
        callback: (error: string | null | undefined, success: boolean) => void,
      ) => {
        const allowed = isAllowedHandshakeOrigin(request.headers, this.#allowedOrigins);
        callback(allowed ? null : "FORBIDDEN_ORIGIN", allowed);
      },
    }) as Server;
    const pub = adapterClient(this.#redisUrl, "finlytics-rt-pub");
    const sub = adapterClient(this.#redisUrl, "finlytics-rt-sub");
    for (const client of [pub, sub]) {
      // Errors are retried by ioredis; an unhandled `error` event would crash the process.
      client.on("error", () => undefined);
      this.#clients.push(client);
    }
    server.adapter(createAdapter(pub, sub, { key: "rt" }));
    this.#servers.add(server);
    return server;
  }

  /**
   * Disconnects the clients and closes Engine.IO, leaving the shared HTTP server to Fastify. Nest may hand over the
   * gateway's namespace rather than the server; either way the root server is closed once.
   */
  override close(target: Server | Namespace): Promise<void> {
    const server = "engine" in target ? target : target.server;
    if (!this.#servers.delete(server)) return Promise.resolve();
    server.local.disconnectSockets(true);
    server.engine.close();
    for (const namespace of server._nsps.values()) {
      const adapter: unknown = namespace.adapter;
      if (
        typeof adapter === "object" &&
        adapter !== null &&
        "close" in adapter &&
        typeof adapter.close === "function"
      ) {
        void Promise.resolve((adapter.close as () => unknown)()).catch(() => undefined);
      }
    }
    return Promise.resolve();
  }

  override async dispose(): Promise<void> {
    await Promise.all(
      this.#clients.splice(0).map(async (client) => {
        try {
          await client.quit();
        } catch {
          client.disconnect();
        }
      }),
    );
  }
}
