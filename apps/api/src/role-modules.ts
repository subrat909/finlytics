/**
 * The modules each process role adds to AppModule (phase 1 plan P1). `http` adds the REST feature modules (listed in
 * app.module.ts); the others are here:
 *
 * | Role | Module | What it runs |
 * |---|---|---|
 * | `gateway` | RealtimeModule | Socket.IO `/rt` on the HTTP server (bootstrap installs RealtimeIoAdapter) |
 * | `feed` | FeedModule | the shared market feed: leader election, connection, subscriptions, tick writes |
 * | `worker` | WorkerModule (jobs/) | BullMQ processors |
 */
import type { DynamicModule, ForwardReference, Type } from "@nestjs/common";

import { hasRole } from "./config/env.schema";
import type { Env } from "./config/env.schema";
import { FeedModule } from "./feed/feed.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { WorkerModule } from "./jobs/worker.module";

export type ImportableModule = Type | DynamicModule | Promise<DynamicModule> | ForwardReference;

/** The non-HTTP role modules for `env.APP_ROLE`. */
export function roleModules(env: Pick<Env, "APP_ROLE">): ImportableModule[] {
  return [
    ...(hasRole(env, "gateway") ? [RealtimeModule] : []),
    ...(hasRole(env, "feed") ? [FeedModule] : []),
    ...(hasRole(env, "worker") ? [WorkerModule] : []),
  ];
}
