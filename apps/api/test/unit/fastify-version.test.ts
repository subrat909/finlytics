/**
 * One fastify (plan D17, build note): the api pins fastify 5.12.5 and pnpm-workspace.yaml overrides
 * @nestjs/platform-fastify's own 5.11.3 pin to the same patched version, with an override scoped to that exact version
 * (`"fastify@5.11.3": "5.12.5"`). Two copies would mean two sets of plugin types and hooks; this checks the copy each
 * one actually resolves, and that the override still selects the version platform-fastify pins.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "../..");

function versionOf(packageJson: string): string {
  return (JSON.parse(readFileSync(packageJson, "utf8")) as { version: string }).version;
}

describe("fastify", () => {
  it("uses the same fastify as @nestjs/platform-fastify", () => {
    const platformDir = path.dirname(require.resolve("@nestjs/platform-fastify/package.json"));
    const platformFastify = require.resolve("fastify/package.json", { paths: [platformDir] });
    const apiFastify = require.resolve("fastify/package.json", { paths: [APP_ROOT] });

    expect(platformFastify).toBe(apiFastify);
    const apiManifest = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(versionOf(apiFastify)).toBe(apiManifest.dependencies["fastify"]);
  });

  it("pins the same version as the workspace override, which selects platform-fastify's own pin", () => {
    const workspace = readFileSync(path.resolve(APP_ROOT, "../../pnpm-workspace.yaml"), "utf8");
    // `  "fastify@5.11.3": "5.12.5"` (or an unscoped `fastify: 5.12.5`) under `overrides:`.
    const override = /^overrides:\s*\n(?:\s+.*\n)*?\s+"?fastify(?:@([\d.]+))?"?:\s*"?([\d.]+)"?/m.exec(workspace);
    const platformManifest = JSON.parse(
      readFileSync(require.resolve("@nestjs/platform-fastify/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };

    expect(override?.[2]).toBe(versionOf(require.resolve("fastify/package.json", { paths: [APP_ROOT] })));
    expect(override?.[1]).toBe(platformManifest.dependencies["fastify"]);
  });
});
