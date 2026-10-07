/**
 * The built app's routes, read from AppModule's module graph without starting anything (plan D8, PR8): test-only probes
 * (`/v1/__test__/*`, test/support) are never part of AppModule, and every controller sits under `v1/` or `health`.
 * The integration test "registers only /v1, /health and /docs routes" checks the same on a running app.
 */
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { DynamicModule, Type } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { loadEnv } from "../../src/config/env";
import { ProbeModule } from "../support/probe.module";

const ENV = loadEnv({
  NODE_ENV: "test",
  // Never connected to: the graph is only read.
  DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/none",
  REDIS_URL: "redis://127.0.0.1:1",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function metadataList(key: string, target: object): unknown[] {
  const value: unknown = Reflect.getMetadata(key, target);
  return Array.isArray(value) ? value : [];
}

/** Every controller reachable from `root`: static `@Module()` metadata and dynamic modules alike. */
async function controllersOf(root: DynamicModule): Promise<Type[]> {
  const seen = new Set<unknown>();
  const controllers: Type[] = [];
  const visit = async (entry: unknown): Promise<void> => {
    const resolved: unknown = entry instanceof Promise ? await entry : entry;
    if (resolved === undefined || seen.has(resolved)) return;
    seen.add(resolved);
    if (typeof resolved === "function") {
      controllers.push(...(metadataList(MODULE_METADATA.CONTROLLERS, resolved) as Type[]));
      for (const imported of metadataList(MODULE_METADATA.IMPORTS, resolved)) await visit(imported);
    } else if (isRecord(resolved)) {
      if (typeof resolved["forwardRef"] === "function") {
        await visit((resolved["forwardRef"] as () => unknown)());
        return;
      }
      await visit(resolved["module"]);
      if (Array.isArray(resolved["controllers"])) controllers.push(...(resolved["controllers"] as Type[]));
      if (Array.isArray(resolved["imports"])) for (const imported of resolved["imports"]) await visit(imported);
    }
  };
  await visit(root);
  return controllers;
}

/** `<controller path>/<method path>` for every route handler of `controller`. */
function routesOf(controller: Type): string[] {
  const join = (...parts: unknown[]) =>
    parts
      .map((part) => (typeof part === "string" ? part.replace(/^\/+|\/+$/g, "") : ""))
      .filter((part) => part !== "")
      .join("/");
  const base: unknown = Reflect.getMetadata(PATH_METADATA, controller);
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .map((name) => prototype[name])
    .filter(
      (handler): handler is object => typeof handler === "function" && Reflect.hasMetadata(METHOD_METADATA, handler),
    )
    .flatMap((handler) => {
      const paths: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      return (Array.isArray(paths) ? paths : [paths]).map((path) => join(base, path));
    });
}

describe("AppModule routes", () => {
  it("registers no /v1/__test__ route", async () => {
    const routes = (await controllersOf(AppModule.forRoot(ENV))).flatMap(routesOf);

    expect(routes).toEqual(expect.arrayContaining(["health/live", "health/ready", "v1/me"]));
    expect(routes.filter((route) => route.includes("__test__"))).toEqual([]);
    for (const route of routes) expect(route).toMatch(/^(?:v1|health)(?:\/|$)/);
  });

  it("finds the probes only when the harness adds them", async () => {
    const routes = (await controllersOf(AppModule.forRoot(ENV, { extraImports: [ProbeModule] }))).flatMap(routesOf);

    expect(routes).toEqual(expect.arrayContaining(["v1/__test__/echo", "v1/__test__/idempotent"]));
  });
});
