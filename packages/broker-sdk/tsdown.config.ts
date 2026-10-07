import { defineConfig } from "tsdown";

/**
 * One artefact for every consumer (foundations plan D1): ESM and CJS from the same source, NestJS requires the CJS
 * build. Node only (ioredis); the browser never imports this package (broker.md: never call a broker from the
 * frontend). Dependencies stay external, so each app resolves zod, decimal.js, ioredis and @finlytics/shared itself.
 */
export default defineConfig((inline) => ({
  // `pnpm dev` runs `tsdown --watch`, and a rebuild must never leave consumers without dist/ (a clean build deletes it
  // first, which broke concurrent test runs). Watch mode overwrites in place; stable chunk names keep it from
  // accumulating stale files. One-off builds still start clean.
  clean: inline.watch === undefined || inline.watch === false,
  hash: false,
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  platform: "node",
  // target: inferred from package.json engines.node (>=24.11).
  // "type": "module" package: ESM as .js + .d.ts, CJS as .cjs + .d.cts (the node platform would default to .mjs).
  fixedExtension: false,
  // Declarations from the TypeScript compiler. isolatedDeclarations (oxc) can't type `export const X = z.object(...)`
  // without explicit annotations.
  dts: { generator: "tsc" },
  deps: {
    // dependencies are external by default. An empty allowlist makes the build fail if anything from node_modules
    // would be bundled, e.g. after a dependency moves to devDependencies.
    onlyBundle: [],
  },
  // CJS is deliberate: NestJS 11 consumes CommonJS. Node 24 could require() the ESM build, but we ship both (D1).
  checks: { legacyCjs: false },
}));
