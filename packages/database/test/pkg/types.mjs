// check:pkg type test. Compiles two tiny consumers against the BUILT declarations, through the package's own name, the
// way apps do: an ESM one (.mts, `import` condition, dist/index.d.ts) and a CJS one (.cts, `require` condition,
// dist/index.d.cts). The consumers live in memory, inside this package's directory so the self-reference resolves;
// nothing is written to disk. Fails on any diagnostic, including an unused @ts-expect-error.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const CONSUMER_SOURCE = `
import { PrismaPg } from "@prisma/adapter-pg";
import { createPrismaClient, Exchange, Prisma, PrismaClient } from "@finlytics/database";
import type { User } from "@finlytics/database";

// The factory's return type resolves to the full client: model delegates, enums and the Prisma namespace.
const client: PrismaClient = createPrismaClient({ url: "postgresql://user:not-a-secret@127.0.0.1:1/none" });
export const users: Promise<User[]> = client.user.findMany({ where: { email: { endsWith: "@example.test" } } });
export const exchange: Exchange = Exchange.NSE;
export const price: Prisma.Decimal = new Prisma.Decimal("24000.05");

// PrismaClient is a type-only export: constructing it directly would bypass createPrismaClient's guards.
// @ts-expect-error -- TS1362: 'PrismaClient' cannot be used as a value because it was exported using 'export type'.
export const bypass = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://127.0.0.1:1/none" }) });
`;

const CONSUMERS = [
  {
    file: path.join(PACKAGE_ROOT, "test", "pkg", "__consumer__.mts"),
    mode: ts.ModuleKind.ESNext,
    declarations: "dist/index.d.ts",
  },
  {
    file: path.join(PACKAGE_ROOT, "test", "pkg", "__consumer__.cts"),
    mode: ts.ModuleKind.CommonJS,
    declarations: "dist/index.d.cts",
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
  const resolved = ts.resolveModuleName(
    "@finlytics/database",
    consumer.file,
    options,
    host,
    undefined,
    undefined,
    consumer.mode,
  ).resolvedModule;
  assert.equal(
    resolved?.resolvedFileName,
    path.join(PACKAGE_ROOT, consumer.declarations),
    `${path.basename(consumer.file)} must resolve the package to ${consumer.declarations}`,
  );
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

console.log("Type test passed: ESM and CJS consumers compile against dist/index.d.ts and dist/index.d.cts");
