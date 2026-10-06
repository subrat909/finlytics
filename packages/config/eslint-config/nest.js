/**
 * Preset for the NestJS api (apps/api, plan phase-0-api-bootstrap §3), applied on top of `base` and `node`.
 *
 * - `@Module()` classes are allowed to be empty (`no-extraneous-class` with `allowWithDecorator`).
 * - No `console`: the api logs through pino (nestjs-pino), which redacts; a stray console line bypasses redaction.
 * - Restriction sets (./restrictions.js), composed with NODE_PROTOCOL:
 *   - NEST_IMPORTS: Prisma only through @finlytics/database (its factory sets the pool timeouts and refuses query
 *     logging), and @finlytics packages only through their exports, never a deep src/ or dist/ path.
 *   - NO_PROCESS_ENV: configuration only through ConfigService<Env, true>; `process.env` is read in src/config,
 *     src/main.ts, scripts, tests and the Vitest configs.
 *   - NO_UNSCOPED: queries go through `this.prisma.db`, the tenancy-guarded client; `unscoped` is allowed in
 *     src/infra/prisma, src/modules/auth (session lookup by token) and src/modules/health (`SELECT 1`).
 *
 * Lifting a ban for a subtree is another restrict() call with the sets that still apply there (the last matching
 * restrict() decides every no-restricted-* rule for a file). Sub-globs start with `**\/` (see ./restrictions.js).
 */
import { ALL_FILES } from "./base.js";
import { NODE_PROTOCOL, defineRestrictionSet, restrict } from "./restrictions.js";

const PRISMA_MESSAGE =
  "Import Prisma from @finlytics/database: its createPrismaClient sets the pool and statement timeouts and refuses " +
  "query logging.";
const DEEP_IMPORT_MESSAGE =
  "Import @finlytics packages through their exports map, never a src/ or dist/ path: the api must load the same " +
  "CJS build that attw checks.";
const PROCESS_ENV_MESSAGE =
  "Read configuration through ConfigService<Env, true>: process.env is validated once, in src/config (plan D3).";
const UNSCOPED_MESSAGE =
  "Query through this.prisma.db, the tenancy-guarded client. The unscoped client is allowed only in " +
  "src/infra/prisma, src/modules/auth and src/modules/health (plan D14).";

/** Prisma only through @finlytics/database; @finlytics packages only through their exports. */
export const NEST_IMPORTS = defineRestrictionSet({
  paths: [{ name: "prisma", message: PRISMA_MESSAGE }],
  patterns: [
    // Also covers @prisma/client and @prisma/adapter-pg.
    { group: ["@prisma/*", "prisma/*"], message: PRISMA_MESSAGE },
    { regex: "^@finlytics/[^/]+/(?:src|dist)(?:/|$)", message: DEEP_IMPORT_MESSAGE },
  ],
});

/** No `process.env` outside the configuration boundary. */
export const NO_PROCESS_ENV = defineRestrictionSet({
  properties: [{ object: "process", property: "env", message: PROCESS_ENV_MESSAGE }],
});

/**
 * No `unscoped` client outside the allowlisted folders, however it is reached: `prisma.unscoped`,
 * `prisma["unscoped"]` (a computed string key) and destructuring (`const { unscoped } = prisma`, also with a quoted
 * key or a rename).
 */
export const NO_UNSCOPED = defineRestrictionSet({
  syntax: [
    { selector: "MemberExpression[property.name='unscoped']", message: UNSCOPED_MESSAGE },
    { selector: "MemberExpression[computed=true][property.value='unscoped']", message: UNSCOPED_MESSAGE },
    { selector: "ObjectPattern > Property[key.name='unscoped']", message: UNSCOPED_MESSAGE },
    { selector: "ObjectPattern > Property[key.value='unscoped']", message: UNSCOPED_MESSAGE },
  ],
});

/** Where `process.env` may be read: the configuration boundary, scripts, tests and the Vitest configs. */
export const NEST_ENV_FILES = ["**/src/config/**", "**/src/main.ts", "**/scripts/**", "**/test/**", "**/*.config.mts"];

/** Where the unscoped Prisma client may be used. */
export const NEST_UNSCOPED_FILES = ["**/src/infra/prisma/**", "**/src/modules/auth/**", "**/src/modules/health/**"];

/** @type {import("eslint").Linter.Config[]} */
export const nest = [
  {
    name: "finlytics/nest/rules",
    files: ALL_FILES,
    rules: {
      "no-console": "error",
      // `@Module({ imports: [...] }) export class AppModule {}` is how Nest declares modules.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },
  restrict("finlytics/nest/restrictions", ALL_FILES, NODE_PROTOCOL, NEST_IMPORTS, NO_PROCESS_ENV, NO_UNSCOPED),
  restrict("finlytics/nest/env-boundary", NEST_ENV_FILES, NODE_PROTOCOL, NEST_IMPORTS, NO_UNSCOPED),
  restrict("finlytics/nest/unscoped-client", NEST_UNSCOPED_FILES, NODE_PROTOCOL, NEST_IMPORTS, NO_PROCESS_ENV),
];
