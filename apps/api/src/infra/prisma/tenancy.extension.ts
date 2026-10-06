/**
 * The tenancy guard (plan D14, docs/01 "Multi-tenancy", docs/06 "IDOR"): a Prisma query extension on
 * `PrismaService.db`. Prisma 7 has no `$use` middleware, so it is `$extends` with a `$allModels.$allOperations` hook
 * that checks the arguments before the query runs. A violation throws TenancyViolationError, which the filter maps to
 * a 500: it is a bug, never a client error. Model knowledge lives in ./user-owned-models.ts.
 *
 * Covered:
 * - **Scoped models** (a `userId` column): reads, updates, deletes and aggregates filter by `userId` (top level, or a
 *   compound unique key that contains it, such as `id_userId`); creates set it on every row; upserts do both. An
 *   update or upsert may not change the owner: `userId` or `user` in its `data` (or `update`) is refused.
 * - **User**, scoped by `id` the same way. Creating a user is allowed.
 * - **AuditLog**: creates only, plus reads that filter by `userId` or `actorId`. Updates and deletes are refused (the
 *   table is append-only); admin reads that span users go through `unscoped`.
 * - **Child models** without `userId` (WatchlistItem, AlertEvent, StrategyRunEvent): scoped through their parent,
 *   `where: { watchlist: { userId } }` (or `{ is: { userId } }`); a create must `connect` a parent by a key that pins
 *   `userId`; `createMany` (scalar foreign keys only) is refused; an update may not move a row to another parent.
 * - **Relation paths**: `include`, `select` (with `_count`), relation filters in `where` (`AND`/`OR`/`NOT`,
 *   `some`/`every`/`none`/`is`/`isNot`), `cursor` and `orderBy` are walked recursively, as are the top-level relation
 *   keys of an unowned model's `data`. Any step from a model no user owns (Plan, Instrument, …) to User or a
 *   user-owned model is refused: `Plan.users` would list every user on a plan, and `Instrument.watchlistItems` every
 *   user's watchlist entries. Steps between user-owned models stay within one user: the database keeps every such
 *   relation inside one user (composite foreign keys, schema.prisma's header).
 * - A model or an operation the guard doesn't know: refused (fail closed).
 *
 * Not covered, by design: raw SQL (`$queryRaw`, `$executeRaw`), which carries no model, and nested writes below the
 * top level of `data` (`User.update({ data: { orders: { create } } })`). Code review and integration tests cover those.
 */
import { Prisma } from "@finlytics/database";

import { isRecord } from "../../common/problem-json/known-errors";

import { CHILD_MODELS, MODEL_RELATIONS, ownershipOf } from "./user-owned-models";

/** A query on a user-owned model that isn't scoped to one user. Maps to INTERNAL (500). */
export class TenancyViolationError extends Error {
  override readonly name = "TenancyViolationError";

  constructor(
    readonly model: string,
    readonly operation: string,
    reason = "must be scoped to one user",
  ) {
    super(`Tenancy guard: ${operation} on ${model} ${reason}`);
  }
}

/** Reads and aggregates: their `where` must carry the scope. */
const READ_OPERATIONS: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** Updates: their `where` must carry the scope, and their `data` must not change the owner. */
const UPDATE_OPERATIONS: ReadonlySet<string> = new Set(["update", "updateMany", "updateManyAndReturn"]);

/** Deletes: their `where` must carry the scope. */
const DELETE_OPERATIONS: ReadonlySet<string> = new Set(["delete", "deleteMany"]);

/** Operations whose `data` must set the owner. */
const CREATE_OPERATIONS: ReadonlySet<string> = new Set(["create", "createMany", "createManyAndReturn"]);

/** Creates that take scalar rows only: no `connect`, so a child row's parent can't be proven. */
const BULK_CREATE_OPERATIONS: ReadonlySet<string> = new Set(["createMany", "createManyAndReturn"]);

/** The fields that name a row's owner: changing them in an update would hand the row to another user. */
const OWNER_FIELDS = ["userId", "user"] as const;

/** Relation filter operators: to-one `is`/`isNot`, to-many `some`/`every`/`none`. */
const RELATION_FILTER_OPERATORS: ReadonlySet<string> = new Set(["is", "isNot", "some", "every", "none"]);

/** Logical operators in a `where`. */
const LOGICAL_OPERATORS: ReadonlySet<string> = new Set(["AND", "OR", "NOT"]);

/**
 * A value that pins one owner: a non-empty string, or `{ equals: "<id>" }`. Anything else (undefined, which Prisma
 * reads as "no filter"; `in`; `not`) doesn't.
 */
function isScopeValue(value: unknown): boolean {
  if (typeof value === "string") return value !== "";
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "equals" && typeof value["equals"] === "string" && value["equals"] !== "";
}

/** Whether `where` pins `field`: directly, or inside a compound unique key whose name contains it (`id_userId`). */
export function whereIsScoped(where: unknown, field: string): boolean {
  if (!isRecord(where)) return false;
  if (isScopeValue(where[field])) return true;
  return Object.entries(where).some(
    ([key, value]) => key.split("_").includes(field) && isRecord(value) && isScopeValue(value[field]),
  );
}

/** Whether a child model's `where` pins its parent's `userId`: `{ watchlist: { userId } }` or `{ is: { userId } }`. */
function whereScopesParent(where: unknown, parentRelation: string): boolean {
  if (!isRecord(where)) return false;
  const filter = where[parentRelation];
  if (!isRecord(filter)) return false;
  return whereIsScoped(Object.hasOwn(filter, "is") ? filter["is"] : filter, "userId");
}

/** Whether a create row sets its owner: `userId`, or `user: { connect: { id } }`. */
function rowHasOwner(row: unknown): boolean {
  if (!isRecord(row)) return false;
  if (isScopeValue(row["userId"])) return true;
  const connect = isRecord(row["user"]) ? row["user"]["connect"] : undefined;
  return isRecord(connect) && isScopeValue(connect["id"]);
}

function dataHasOwner(data: unknown): boolean {
  return Array.isArray(data) ? data.length > 0 && data.every(rowHasOwner) : rowHasOwner(data);
}

/** Whether a child's create row connects a parent by a key that pins the parent's `userId`. */
function rowConnectsScopedParent(row: unknown, parentRelation: string): boolean {
  if (!isRecord(row)) return false;
  const parent = row[parentRelation];
  return isRecord(parent) && whereIsScoped(parent["connect"], "userId");
}

/** Whether update data names any of `fields`. */
function dataTouches(data: unknown, fields: readonly string[]): boolean {
  return isRecord(data) && fields.some((field) => Object.hasOwn(data, field));
}

function argument(args: unknown, name: string): unknown {
  return isRecord(args) ? args[name] : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Relation paths

/** Walks every relation path an operation's arguments take, refusing a step from an unowned to an owned model. */
class RelationWalker {
  constructor(
    private readonly rootModel: string,
    private readonly operation: string,
  ) {}

  /** The model a relation field of `model` leads to, after checking the step is allowed; undefined for a scalar. */
  private step(model: string, field: string): string | undefined {
    const target = MODEL_RELATIONS[model]?.[field];
    if (target === undefined) return undefined;
    if (ownershipOf(model) === "unowned" && ownershipOf(target) !== "unowned") {
      throw new TenancyViolationError(
        this.rootModel,
        this.operation,
        `must not follow ${model}.${field}: a model no user owns would reach ${target} rows of every user`,
      );
    }
    return target;
  }

  /** `include` or `select` of `model`. */
  selection(model: string, selection: unknown): void {
    if (!isRecord(selection)) return;
    for (const [field, value] of Object.entries(selection)) {
      if (field === "_count") {
        this.count(model, value);
        continue;
      }
      const target = this.step(model, field);
      if (target !== undefined) this.nestedArgs(target, value);
    }
  }

  /** `_count: true` counts every relation of `model`; `_count: { select: { rel: true | { where } } }` some. */
  private count(model: string, value: unknown): void {
    if (value === true) {
      for (const field of Object.keys(MODEL_RELATIONS[model] ?? {})) this.step(model, field);
      return;
    }
    const select = argument(value, "select");
    if (!isRecord(select)) return;
    for (const [field, filter] of Object.entries(select)) {
      const target = this.step(model, field);
      if (target !== undefined) this.where(target, argument(filter, "where"));
    }
  }

  /** The arguments of an included or selected relation: `true`, or `{ select, include, where, orderBy, cursor }`. */
  private nestedArgs(model: string, args: unknown): void {
    if (!isRecord(args)) return;
    this.selection(model, args["select"]);
    this.selection(model, args["include"]);
    this.where(model, args["where"]);
    this.where(model, args["cursor"]);
    this.orderBy(model, args["orderBy"]);
  }

  /** A `where` (or `cursor`) of `model`. */
  where(model: string, where: unknown): void {
    if (Array.isArray(where)) {
      for (const item of where) this.where(model, item);
      return;
    }
    if (!isRecord(where)) return;
    for (const [field, value] of Object.entries(where)) {
      if (LOGICAL_OPERATORS.has(field)) {
        this.where(model, value);
        continue;
      }
      const target = this.step(model, field);
      if (target !== undefined) this.relationFilter(target, value);
    }
  }

  /** A relation filter: `null`, `{ is | isNot | some | every | none: where }`, or the target's own `where`. */
  private relationFilter(model: string, filter: unknown): void {
    if (!isRecord(filter)) return;
    for (const [key, value] of Object.entries(filter)) {
      if (RELATION_FILTER_OPERATORS.has(key)) this.where(model, value);
      else this.where(model, { [key]: value });
    }
  }

  /** An `orderBy` of `model`: an object or a list, ordering by relations (`{ user: { name } }`, `_count`) too. */
  orderBy(model: string, orderBy: unknown): void {
    if (Array.isArray(orderBy)) {
      for (const item of orderBy) this.orderBy(model, item);
      return;
    }
    if (!isRecord(orderBy)) return;
    for (const [field, value] of Object.entries(orderBy)) {
      const target = this.step(model, field);
      if (target !== undefined) this.orderBy(target, value);
    }
  }

  /** The top-level relation keys of write data (`connect`, `create`, … below them are not walked). */
  data(model: string, data: unknown): void {
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      for (const field of Object.keys(row)) this.step(model, field);
    }
  }
}

/** Refuses a relation path from a model no user owns to User or a user-owned model (see the header). */
export function assertRelationPaths(model: string, operation: string, args: unknown): void {
  const walker = new RelationWalker(model, operation);
  walker.selection(model, argument(args, "select"));
  walker.selection(model, argument(args, "include"));
  walker.where(model, argument(args, "where"));
  walker.where(model, argument(args, "cursor"));
  walker.orderBy(model, argument(args, "orderBy"));
  if (ownershipOf(model) === "unowned") {
    walker.data(model, argument(args, "data"));
    walker.data(model, argument(args, "create"));
    walker.data(model, argument(args, "update"));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Scope rules per kind of model

function assertUserScope(model: string, operation: string, args: unknown): void {
  if (CREATE_OPERATIONS.has(operation)) return;
  const where = argument(args, "where");
  const known =
    READ_OPERATIONS.has(operation) ||
    UPDATE_OPERATIONS.has(operation) ||
    DELETE_OPERATIONS.has(operation) ||
    operation === "upsert";
  if (!known || !whereIsScoped(where, "id")) throw new TenancyViolationError(model, operation);
}

function assertScopedModel(model: string, operation: string, args: unknown): void {
  const where = argument(args, "where");
  if (READ_OPERATIONS.has(operation) || DELETE_OPERATIONS.has(operation)) {
    if (!whereIsScoped(where, "userId")) throw new TenancyViolationError(model, operation);
    return;
  }
  if (UPDATE_OPERATIONS.has(operation)) {
    if (!whereIsScoped(where, "userId")) throw new TenancyViolationError(model, operation);
    if (dataTouches(argument(args, "data"), OWNER_FIELDS)) {
      throw new TenancyViolationError(model, operation, "must not change a row's owner (userId or user)");
    }
    return;
  }
  if (CREATE_OPERATIONS.has(operation)) {
    if (!dataHasOwner(argument(args, "data"))) throw new TenancyViolationError(model, operation);
    return;
  }
  if (operation === "upsert") {
    if (!whereIsScoped(where, "userId") || !rowHasOwner(argument(args, "create"))) {
      throw new TenancyViolationError(model, operation);
    }
    if (dataTouches(argument(args, "update"), OWNER_FIELDS)) {
      throw new TenancyViolationError(model, operation, "must not change a row's owner (userId or user)");
    }
    return;
  }
  throw new TenancyViolationError(model, operation); // an operation this guard doesn't know: fail closed
}

function assertAuditLog(model: string, operation: string, args: unknown): void {
  if (CREATE_OPERATIONS.has(operation)) return;
  if (!READ_OPERATIONS.has(operation)) {
    throw new TenancyViolationError(model, operation, "is refused: the audit log is append-only");
  }
  const where = argument(args, "where");
  if (!whereIsScoped(where, "userId") && !whereIsScoped(where, "actorId")) {
    throw new TenancyViolationError(
      model,
      operation,
      "must filter by userId or actorId (admin reads that span users use the unscoped client)",
    );
  }
}

function assertChildModel(model: string, operation: string, args: unknown): void {
  const child = CHILD_MODELS[model];
  if (child === undefined) throw new TenancyViolationError(model, operation);
  const parentScoped = whereScopesParent(argument(args, "where"), child.parentRelation);
  const moved = (data: unknown): boolean => dataTouches(data, [child.parentRelation, child.foreignKey]);
  const reason = `must be scoped through ${child.parentRelation}.userId`;

  if (READ_OPERATIONS.has(operation) || DELETE_OPERATIONS.has(operation)) {
    if (!parentScoped) throw new TenancyViolationError(model, operation, reason);
    return;
  }
  if (UPDATE_OPERATIONS.has(operation)) {
    if (!parentScoped) throw new TenancyViolationError(model, operation, reason);
    if (moved(argument(args, "data"))) {
      throw new TenancyViolationError(model, operation, `must not move a row to another ${child.parentRelation}`);
    }
    return;
  }
  if (BULK_CREATE_OPERATIONS.has(operation)) {
    throw new TenancyViolationError(
      model,
      operation,
      `is refused: bulk creates can't prove the ${child.parentRelation}'s owner (create through the scoped parent)`,
    );
  }
  if (operation === "create") {
    if (!rowConnectsScopedParent(argument(args, "data"), child.parentRelation)) {
      throw new TenancyViolationError(model, operation, `must connect a ${child.parentRelation} by a key with userId`);
    }
    return;
  }
  if (operation === "upsert") {
    if (!parentScoped || !rowConnectsScopedParent(argument(args, "create"), child.parentRelation)) {
      throw new TenancyViolationError(model, operation, reason);
    }
    if (moved(argument(args, "update"))) {
      throw new TenancyViolationError(model, operation, `must not move a row to another ${child.parentRelation}`);
    }
    return;
  }
  throw new TenancyViolationError(model, operation); // an operation this guard doesn't know: fail closed
}

/**
 * Throws TenancyViolationError unless `args` keep `operation` on `model` within one user. Pure, so every rule is unit
 * tested without a database. `model` is undefined only for raw queries, which the guard can't see into.
 */
export function assertTenancy(model: string | undefined, operation: string, args: unknown): void {
  if (model === undefined) return;
  switch (ownershipOf(model)) {
    case "user":
      assertUserScope(model, operation, args);
      break;
    case "scoped":
      assertScopedModel(model, operation, args);
      break;
    case "audit":
      assertAuditLog(model, operation, args);
      break;
    case "child":
      assertChildModel(model, operation, args);
      break;
    case "unowned":
      break;
    case undefined:
      throw new TenancyViolationError(model, operation, "is refused: the tenancy guard doesn't know this model");
  }
  assertRelationPaths(model, operation, args);
}

/** The query extension. */
export const tenancyGuard = Prisma.defineExtension({
  name: "finlytics-tenancy-guard",
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        assertTenancy(model, operation, args);
        return query(args);
      },
    },
  },
});
