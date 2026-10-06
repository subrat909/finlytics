import { defineConfig } from "tsdown";

/**
 * One artefact for every consumer (plan D1, D2): Next.js imports the ESM build, NestJS requires the CJS build, so
 * neither ever runs `prisma generate`. The generated client (src/generated) is bundled in; dependencies stay external.
 *
 * Two entries (0.5 plan D16): `index` (the client) and `testing` (`@finlytics/database/testing`: a migrated
 * Testcontainers database for integration tests). They share no module, so the client never loads testcontainers.
 */
export default defineConfig({
  entry: { index: "src/index.ts", testing: "src/testing/index.ts" },
  format: ["esm", "cjs"],
  // No `shims`: src/testing uses import.meta.url, which tsdown always shims in CJS output; `shims` would only add
  // __dirname and __filename to the ESM output, which nothing uses.
  platform: "node",
  // target: inferred from package.json engines.node (>=24.11).
  // "type": "module" package: ESM as .js + .d.ts, CJS as .cjs + .d.cts (the node platform would default to .mjs).
  fixedExtension: false,
  // Declarations from the TypeScript compiler. isolatedDeclarations (oxc) can't type `export const X = z.object(...)`
  // or the generated client without explicit annotations.
  dts: { generator: "tsc" },
  deps: {
    // dependencies (@prisma/client, @prisma/adapter-pg, pg, zod) and peer dependencies (testcontainers,
    // @testcontainers/postgresql) are external by default. An empty allowlist makes the build fail if anything from
    // node_modules would be bundled, e.g. after a dependency moves to devDependencies.
    onlyBundle: [],
  },
  // CJS is deliberate: NestJS 11 consumes CommonJS. Node 24 could require() the ESM build, but we ship both (D1).
  checks: { legacyCjs: false },
});
