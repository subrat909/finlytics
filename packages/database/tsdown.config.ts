import { defineConfig } from "tsdown";

/**
 * One artefact for every consumer (plan D1, D2): Next.js imports the ESM build, NestJS requires the CJS build, so
 * neither ever runs `prisma generate`. The generated client (src/generated) is bundled in; dependencies stay external.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  platform: "node",
  // target: inferred from package.json engines.node (>=24.11).
  // "type": "module" package: ESM as .js + .d.ts, CJS as .cjs + .d.cts (the node platform would default to .mjs).
  fixedExtension: false,
  // Declarations from the TypeScript compiler. isolatedDeclarations (oxc) can't type `export const X = z.object(...)`
  // or the generated client without explicit annotations.
  dts: { generator: "tsc" },
  deps: {
    // dependencies (@prisma/client, @prisma/adapter-pg, pg, zod) are external by default. An empty allowlist makes
    // the build fail if anything from node_modules would be bundled, e.g. after a dependency moves to devDependencies.
    onlyBundle: [],
  },
  // CJS is deliberate: NestJS 11 consumes CommonJS. Node 24 could require() the ESM build, but we ship both (D1).
  checks: { legacyCjs: false },
});
