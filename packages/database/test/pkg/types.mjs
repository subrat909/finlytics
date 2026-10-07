// check:pkg type test. Compiles two tiny consumers against the BUILT declarations, through the package's own name, the
// way apps do: an ESM one (.mts, `import` condition, dist/index.d.ts and dist/testing.d.ts) and a CJS one (.cts,
// `require` condition, dist/index.d.cts and dist/testing.d.cts). The consumers live in memory, inside this package's
// directory so the self-reference resolves; nothing is written to disk. Fails on any diagnostic, including an
// expect-error directive that no longer has an error to expect.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const CONSUMER_SOURCE = `
import { PrismaPg } from "@prisma/adapter-pg";
import {
  checkDatabaseEnv,
  createPrismaClient,
  databaseEnvShape,
  Exchange,
  loadDatabaseEnv,
  Prisma,
  PrismaClient,
  prismaClientOptionsFromEnv,
} from "@finlytics/database";
import type { DatabaseEnv, User } from "@finlytics/database";
import { migrateDeploy, startTestDatabase, TIMESCALE_IMAGE } from "@finlytics/database/testing";
import type { PrismaCliTarget, StartedTestDatabase } from "@finlytics/database/testing";

// The factory's return type resolves to the full client: model delegates, enums and the Prisma namespace.
const client: PrismaClient = createPrismaClient({ url: "postgresql://user:not-a-secret@127.0.0.1:1/none" });
export const users: Promise<User[]> = client.user.findMany({ where: { email: { endsWith: "@example.test" } } });
export const exchange: Exchange = Exchange.NSE;
export const price: Prisma.Decimal = new Prisma.Decimal("24000.05");

// PrismaClient is a type-only export: constructing it directly would bypass createPrismaClient's guards.
// @ts-expect-error -- TS1362: 'PrismaClient' cannot be used as a value because it was exported using 'export type'.
export const bypass = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://127.0.0.1:1/none" }) });

// The api composes its env schema from the database shape and check, and configures its client from the result.
export const env: DatabaseEnv = loadDatabaseEnv({ DATABASE_URL: "postgresql://user:not-a-secret@127.0.0.1:1/none" });
export const apiClient: PrismaClient = createPrismaClient({
  ...prismaClientOptionsFromEnv(env),
  applicationName: "finlytics-api",
  transaction: { maxWaitMs: 2_000, timeoutMs: 12_000 },
});
export const shapeKeys: string[] = Object.keys(databaseEnvShape);
export const check: typeof checkDatabaseEnv = checkDatabaseEnv;

// The testing entry: its own declarations, with no testcontainers type in its public surface.
export const started: Promise<StartedTestDatabase> = startTestDatabase({ migrate: true });
export const image: string = TIMESCALE_IMAGE;
export const deploy: (target: PrismaCliTarget) => Promise<string> = migrateDeploy;
`;

const CONSUMERS = [
  {
    file: path.join(PACKAGE_ROOT, "test", "pkg", "__consumer__.mts"),
    mode: ts.ModuleKind.ESNext,
    declarations: { "@finlytics/database": "dist/index.d.ts", "@finlytics/database/testing": "dist/testing.d.ts" },
  },
  {
    file: path.join(PACKAGE_ROOT, "test", "pkg", "__consumer__.cts"),
    mode: ts.ModuleKind.CommonJS,
    declarations: { "@finlytics/database": "dist/index.d.cts", "@finlytics/database/testing": "dist/testing.d.cts" },
  },
];

const options = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2023,
  lib: ["lib.es2023.d.ts"],
  types: ["node"],
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  skipLibCheck: true,
  noEmit: true,
};

const host = ts.createCompilerHost(options, true);
const isConsumer = (fileName) => CONSUMERS.some((consumer) => path.resolve(fileName) === consumer.file);
const { fileExists, readFile, getSourceFile } = host;
host.fileExists = (fileName) => isConsumer(fileName) || fileExists.call(host, fileName);
host.readFile = (fileName) => (isConsumer(fileName) ? CONSUMER_SOURCE : readFile.call(host, fileName));
host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
  isConsumer(fileName)
    ? ts.createSourceFile(fileName, CONSUMER_SOURCE, languageVersion, true)
    : getSourceFile.call(host, fileName, languageVersion, onError, shouldCreate);

for (const consumer of CONSUMERS) {
  for (const [specifier, declarations] of Object.entries(consumer.declarations)) {
    const resolved = ts.resolveModuleName(
      specifier,
      consumer.file,
      options,
      host,
      undefined,
      undefined,
      consumer.mode,
    ).resolvedModule;
    assert.equal(
      resolved?.resolvedFileName,
      path.join(PACKAGE_ROOT, declarations),
      `${path.basename(consumer.file)} must resolve ${specifier} to ${declarations}`,
    );
  }
}

const program = ts.createProgram(
  CONSUMERS.map((consumer) => consumer.file),
  options,
  host,
);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => PACKAGE_ROOT,
    getNewLine: () => "\n",
  }),
);

console.log(
  "Type test passed: ESM and CJS consumers compile against the index and testing declarations of both builds",
);
