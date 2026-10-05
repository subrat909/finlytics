import { defineConfig } from "tsdown";

/**
 * One artefact for every consumer (plan D1): Next.js imports the ESM build (server and browser), NestJS requires the
 * CJS build. zod and decimal.js stay external, so each app resolves them itself.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // The ESM build runs in browsers as well as on Node, so it may assume neither. (tsdown always builds CJS for node.)
  platform: "neutral",
  // A language level instead of the default (engines.node), because browsers consume this package too. Matches the
  // `target` in tsconfig.base.json.
  target: "es2022",
  // "type": "module" package: ESM as .js + .d.ts, CJS as .cjs + .d.cts.
  fixedExtension: false,
  // Declarations from the TypeScript compiler. isolatedDeclarations (oxc) can't type `export const X = z.object(...)`
  // without explicit annotations.
  dts: { generator: "tsc" },
  deps: {
    // dependencies (zod, decimal.js) are external by default. An empty allowlist makes the build fail if anything from
    // node_modules would be bundled, e.g. after a dependency moves to devDependencies.
    onlyBundle: [],
  },
  // CJS is deliberate: NestJS 11 consumes CommonJS. Node 24 could require() the ESM build, but we ship both (D1).
  checks: { legacyCjs: false },
});
