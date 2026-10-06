import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertTenancy, TenancyViolationError, whereIsScoped } from "../tenancy.extension";
import {
  AUDIT_LOG_MODEL,
  CHILD_MODELS,
  MODEL_RELATIONS,
  ownershipOf,
  UNOWNED_MODELS,
  USER_MODEL,
  USER_SCOPED_MODELS,
} from "../user-owned-models";

const violation = (model: string, operation: string, args: unknown) => () => {
  assertTenancy(model, operation, args);
};

describe("tenancy guard", () => {
  it("rejects reads, updates and deletes on user-owned models without userId", () => {
    for (const operation of [
      "findMany",
      "findFirst",
      "findUnique",
      "count",
      "aggregate",
      "groupBy",
      "updateMany",
      "deleteMany",
      "delete",
      "update",
    ]) {
      expect(violation("Order", operation, { where: { status: "OPEN" } }), operation).toThrow(TenancyViolationError);
      expect(violation("Order", operation, {}), operation).toThrow(TenancyViolationError);
    }
    // Prisma reads undefined as "no filter"; neither `in` nor `not` pins one owner.
    for (const userId of [undefined, null, "", { in: ["u1", "u2"] }, { not: "u1" }, { equals: "u1", not: "u2" }, 7]) {
      expect(violation("Order", "findMany", { where: { userId } }), JSON.stringify(userId)).toThrow(
        TenancyViolationError,
      );
    }
    expect(violation("Order", "findMany", undefined)).toThrow(/findMany on Order must be scoped to one user/);
  });

  it("accepts a top-level userId and compound unique keys that contain userId", () => {
    expect(violation("Order", "findMany", { where: { userId: "u1", status: "OPEN" } })).not.toThrow();
    expect(violation("Order", "count", { where: { userId: { equals: "u1" } } })).not.toThrow();
    expect(violation("Order", "findUnique", { where: { id_userId: { id: "o1", userId: "u1" } } })).not.toThrow();
    expect(
      violation("Order", "findUnique", { where: { userId_idempotencyKey: { userId: "u1", idempotencyKey: "k" } } }),
    ).not.toThrow();
    expect(
      violation("DailyPnl", "delete", {
        where: { userId_date_isPaper: { userId: "u1", date: new Date(), isPaper: false } },
      }),
    ).not.toThrow();
    expect(
      violation("Order", "findUnique", {
        where: { brokerAccountId_brokerOrderId: { brokerAccountId: "b", brokerOrderId: "x" } },
      }),
    ).toThrow(TenancyViolationError);
    expect(whereIsScoped({ id_userId: { id: "o1" } }, "userId")).toBe(false);
  });

  it("requires creates to set the owner on every row", () => {
    expect(violation("Watchlist", "create", { data: { userId: "u1", name: "Main" } })).not.toThrow();
    expect(violation("Watchlist", "create", { data: { user: { connect: { id: "u1" } }, name: "Main" } })).not.toThrow();
    expect(violation("Watchlist", "create", { data: { name: "Main" } })).toThrow(TenancyViolationError);
    expect(violation("Watchlist", "create", { data: { user: { connect: { email: "a@b.c" } }, name: "x" } })).toThrow(
      TenancyViolationError,
    );
  });

  it("rejects createMany when any row lacks userId", () => {
    expect(violation("Alert", "createMany", { data: [{ userId: "u1" }, { userId: "u1" }] })).not.toThrow();
    expect(violation("Alert", "createManyAndReturn", { data: [{ userId: "u1" }, { name: "x" }] })).toThrow(
      TenancyViolationError,
    );
    expect(violation("Alert", "createMany", { data: [] })).toThrow(TenancyViolationError);
  });

  it("requires upserts to be scoped and to create an owned row", () => {
    expect(
      violation("RiskLimit", "upsert", { where: { userId: "u1" }, create: { userId: "u1" }, update: {} }),
    ).not.toThrow();
    expect(violation("RiskLimit", "upsert", { where: { userId: "u1" }, create: {}, update: {} })).toThrow(
      TenancyViolationError,
    );
    expect(violation("RiskLimit", "upsert", { where: {}, create: { userId: "u1" }, update: {} })).toThrow(
      TenancyViolationError,
    );
  });

  it("fails closed on an operation it doesn't know", () => {
    expect(violation("Order", "findRaw", { where: { userId: "u1" } })).toThrow(TenancyViolationError);
  });

  it("scopes User by id", () => {
    expect(violation(USER_MODEL, "findUnique", { where: { id: "u1" } })).not.toThrow();
    expect(violation(USER_MODEL, "update", { where: { id: "u1" }, data: { name: "x" } })).not.toThrow();
    expect(violation(USER_MODEL, "upsert", { where: { id: "u1" }, create: {}, update: {} })).not.toThrow();
    expect(violation(USER_MODEL, "create", { data: { email: "a@b.c" } })).not.toThrow();
    expect(violation(USER_MODEL, "findFirst", { where: { email: "a@b.c" } })).toThrow(TenancyViolationError);
    expect(violation(USER_MODEL, "findMany", {})).toThrow(TenancyViolationError);
    expect(violation(USER_MODEL, "deleteMany", { where: { deletedAt: { not: null } } })).toThrow(TenancyViolationError);
    expect(violation(USER_MODEL, "findRaw", { where: { id: "u1" } })).toThrow(TenancyViolationError);
  });

  it("leaves models no user owns alone, and refuses a model it doesn't know", () => {
    for (const model of ["Instrument", "Plan", "MarketHoliday", "GlobalControl", "Tick", "VerificationToken"]) {
      expect(violation(model, "findMany", {}), model).not.toThrow();
      expect(violation(model, "deleteMany", {}), model).not.toThrow();
    }
    expect(violation(undefined as unknown as string, "$queryRaw", {})).not.toThrow();
    expect(violation("NewModel", "findMany", {})).toThrow(/doesn't know this model/);
  });
});

describe("tenancy guard: AuditLog", () => {
  it("allows creates without an owner (system actors have none)", () => {
    for (const operation of ["create", "createMany", "createManyAndReturn"]) {
      expect(violation("AuditLog", operation, { data: { actorType: "system", action: "x" } }), operation).not.toThrow();
    }
  });

  it("requires reads to filter by userId or actorId", () => {
    expect(violation("AuditLog", "findMany", { where: { userId: "u1" } })).not.toThrow();
    expect(violation("AuditLog", "findMany", { where: { actorId: "u1", action: "settings.update" } })).not.toThrow();
    expect(violation("AuditLog", "count", { where: { actorId: { equals: "admin1" } } })).not.toThrow();
    for (const where of [{}, { action: "settings.update" }, { userId: { in: ["u1", "u2"] } }, { requestId: "r" }]) {
      expect(violation("AuditLog", "findMany", { where }), JSON.stringify(where)).toThrow(/userId or actorId/);
    }
    expect(violation("AuditLog", "aggregate", {})).toThrow(TenancyViolationError);
  });

  it("refuses updates and deletes: the log is append-only", () => {
    for (const operation of ["update", "updateMany", "delete", "deleteMany", "upsert"]) {
      expect(violation("AuditLog", operation, { where: { userId: "u1" }, data: {} }), operation).toThrow(/append-only/);
    }
  });
});

describe("tenancy guard: owner changes", () => {
  it("refuses an update or upsert that would hand a row to another user", () => {
    for (const operation of ["update", "updateMany", "updateManyAndReturn"]) {
      expect(violation("Order", operation, { where: { userId: "u1" }, data: { userId: "u2" } }), operation).toThrow(
        /must not change a row's owner/,
      );
      expect(
        violation("Order", operation, { where: { userId: "u1" }, data: { user: { connect: { id: "u2" } } } }),
        operation,
      ).toThrow(/must not change a row's owner/);
      expect(
        violation("Order", operation, { where: { userId: "u1" }, data: { status: "OPEN" } }),
        operation,
      ).not.toThrow();
    }
    expect(
      violation("RiskLimit", "upsert", {
        where: { userId: "u1" },
        create: { userId: "u1" },
        update: { userId: "u2" },
      }),
    ).toThrow(/must not change a row's owner/);
    expect(
      violation("Session", "updateMany", { where: { id: "s1", userId: "u1" }, data: { lastSeenAt: new Date() } }),
    ).not.toThrow();
  });
});

describe("tenancy guard: child models", () => {
  it("scopes WatchlistItem, AlertEvent and StrategyRunEvent through their parent's userId", () => {
    const cases: [string, string][] = [
      ["WatchlistItem", "watchlist"],
      ["AlertEvent", "alert"],
      ["StrategyRunEvent", "deployment"],
    ];
    for (const [model, parent] of cases) {
      for (const operation of ["findMany", "findFirst", "findUnique", "count", "deleteMany", "delete", "updateMany"]) {
        expect(
          violation(model, operation, { where: { [parent]: { userId: "u1" } } }),
          `${model} ${operation}`,
        ).not.toThrow();
        expect(
          violation(model, operation, { where: { id: "x", [parent]: { is: { userId: "u1" } } } }),
          `${model} ${operation} is`,
        ).not.toThrow();
        expect(violation(model, operation, { where: {} }), `${model} ${operation} {}`).toThrow(
          `must be scoped through ${parent}.userId`,
        );
      }
      // A foreign key proves nothing about the owner.
      expect(violation(model, "findMany", { where: { [`${parent}Id`]: "p1" } }), model).toThrow(TenancyViolationError);
      expect(violation(model, "findMany", { where: { [parent]: { name: "Main" } } }), model).toThrow(
        TenancyViolationError,
      );
      expect(violation(model, "findMany", { where: { [parent]: { userId: { in: ["u1", "u2"] } } } }), model).toThrow(
        TenancyViolationError,
      );
    }
  });

  it("creates a child only by connecting a parent through a key that pins its owner", () => {
    expect(
      violation("WatchlistItem", "create", {
        data: { watchlist: { connect: { id: "w1", userId: "u1" } }, instrument: { connect: { key: "NSE_EQ|X" } } },
      }),
    ).not.toThrow();
    expect(
      violation("WatchlistItem", "create", {
        data: { watchlist: { connect: { userId_name: { userId: "u1", name: "Main" } } }, instrumentKey: "NSE_EQ|X" },
      }),
    ).not.toThrow();
    for (const data of [
      { watchlistId: "w1", instrumentKey: "NSE_EQ|X" },
      { watchlist: { connect: { id: "w1" } }, instrumentKey: "NSE_EQ|X" },
      { watchlist: { create: { userId: "u1", name: "x" } }, instrumentKey: "NSE_EQ|X" },
    ]) {
      expect(violation("WatchlistItem", "create", { data }), JSON.stringify(data)).toThrow(TenancyViolationError);
    }
    for (const operation of ["createMany", "createManyAndReturn"]) {
      expect(violation("AlertEvent", operation, { data: [{ alertId: "a1", value: 1 }] }), operation).toThrow(
        /bulk creates/,
      );
    }
  });

  it("never moves a child row to another parent, and fails closed on unknown operations", () => {
    for (const data of [{ watchlistId: "w2" }, { watchlist: { connect: { id: "w2", userId: "u1" } } }]) {
      expect(
        violation("WatchlistItem", "update", { where: { id: "i1", watchlist: { userId: "u1" } }, data }),
        JSON.stringify(data),
      ).toThrow(/must not move a row/);
    }
    expect(
      violation("WatchlistItem", "upsert", {
        where: { id: "i1", watchlist: { userId: "u1" } },
        create: { watchlist: { connect: { id: "w1", userId: "u1" } }, instrumentKey: "NSE_EQ|X", position: 0 },
        update: { position: 2 },
      }),
    ).not.toThrow();
    expect(
      violation("WatchlistItem", "upsert", {
        where: { id: "i1", watchlist: { userId: "u1" } },
        create: { watchlistId: "w1", instrumentKey: "NSE_EQ|X", position: 0 },
        update: {},
      }),
    ).toThrow(TenancyViolationError);
    expect(
      violation("WatchlistItem", "upsert", {
        where: { id: "i1", watchlist: { userId: "u1" } },
        create: { watchlist: { connect: { id: "w1", userId: "u1" } }, instrumentKey: "NSE_EQ|X", position: 0 },
        update: { watchlistId: "w2" },
      }),
    ).toThrow(/must not move a row/);
    expect(violation("WatchlistItem", "findRaw", { where: { watchlist: { userId: "u1" } } })).toThrow(
      TenancyViolationError,
    );
  });
});

describe("tenancy guard: relation paths", () => {
  it("refuses include and select paths from a model no user owns to an owned one", () => {
    expect(violation("Plan", "findMany", { include: { users: true } })).toThrow(/must not follow Plan\.users/);
    expect(violation("Plan", "findMany", { select: { code: true, users: { select: { id: true } } } })).toThrow(
      /Plan\.users/,
    );
    expect(violation("Instrument", "findUnique", { where: { key: "k" }, include: { watchlistItems: true } })).toThrow(
      /Instrument\.watchlistItems/,
    );
    expect(violation("Plan", "findMany", { select: { _count: true } })).toThrow(/Plan\.users/);
    expect(violation("Plan", "findMany", { select: { _count: { select: { users: true } } } })).toThrow(/Plan\.users/);
    // Reference data alone is fine.
    expect(violation("Plan", "findMany", { select: { code: true, name: true } })).not.toThrow();
    expect(violation("Instrument", "findMany", { where: { symbol: "NIFTY" }, orderBy: { key: "asc" } })).not.toThrow();
  });

  it("refuses such paths at any depth, from any root", () => {
    // User → plan is fine (one plan); plan → users would list every user on it.
    expect(violation("User", "findUnique", { where: { id: "u1" }, include: { plan: true } })).not.toThrow();
    expect(
      violation("User", "findUnique", { where: { id: "u1" }, include: { plan: { include: { users: true } } } }),
    ).toThrow(/Plan\.users/);
    expect(
      violation("WatchlistItem", "findMany", {
        where: { watchlist: { userId: "u1" } },
        select: { instrument: { select: { name: true, watchlistItems: { where: { position: 0 } } } } },
      }),
    ).toThrow(/Instrument\.watchlistItems/);
    expect(
      violation("WatchlistItem", "findMany", {
        where: { watchlist: { userId: "u1" } },
        include: { instrument: { select: { _count: { select: { watchlistItems: true } } } } },
      }),
    ).toThrow(/Instrument\.watchlistItems/);
    // Between user-owned models (kept within one user by composite foreign keys): allowed.
    expect(
      violation("Order", "findMany", {
        where: { userId: "u1" },
        include: { brokerAccount: { include: { positions: true } }, trades: true, user: { select: { email: true } } },
      }),
    ).not.toThrow();
  });

  it("refuses relation filters and orderings that cross from an unowned model", () => {
    for (const where of [
      { users: { some: { email: "a@b.c" } } },
      { users: { none: {} } },
      { OR: [{ code: "pro" }, { users: { every: { deletedAt: null } } }] },
      { NOT: { users: { some: {} } } },
      { AND: [{ users: { some: { id: "u1" } } }] },
    ]) {
      expect(violation("Plan", "findMany", { where }), JSON.stringify(where)).toThrow(/Plan\.users/);
    }
    expect(
      violation("WatchlistItem", "findMany", {
        where: { watchlist: { userId: "u1" }, instrument: { is: { watchlistItems: { some: { position: 1 } } } } },
      }),
    ).toThrow(/Instrument\.watchlistItems/);
    expect(
      violation("WatchlistItem", "findMany", {
        where: { watchlist: { userId: "u1" }, instrument: { symbol: "NIFTY" } },
      }),
    ).not.toThrow();
    expect(violation("Plan", "findMany", { orderBy: { users: { _count: "desc" } } })).toThrow(/Plan\.users/);
    expect(violation("Plan", "findMany", { orderBy: [{ code: "asc" }, { users: { _count: "desc" } }] })).toThrow(
      /Plan\.users/,
    );
    expect(violation("Plan", "findMany", { cursor: { id: "p1" }, orderBy: [{ code: "asc" }] })).not.toThrow();
  });

  it("refuses writes from an unowned model that reach owned rows", () => {
    expect(violation("Plan", "update", { where: { id: "p1" }, data: { users: { connect: { id: "u1" } } } })).toThrow(
      /Plan\.users/,
    );
    expect(
      violation("Instrument", "update", { where: { key: "k" }, data: { watchlistItems: { deleteMany: {} } } }),
    ).toThrow(/Instrument\.watchlistItems/);
    expect(
      violation("Plan", "upsert", { where: { code: "pro" }, create: { code: "pro" }, update: { users: { set: [] } } }),
    ).toThrow(/Plan\.users/);
    expect(violation("Plan", "update", { where: { id: "p1" }, data: { name: "Pro" } })).not.toThrow();
  });
});

describe("tenancy guard: model list", () => {
  const schemaPath = path.join(
    path.dirname(require.resolve("@finlytics/database/package.json")),
    "prisma",
    "schema.prisma",
  );
  const schema = readFileSync(schemaPath, "utf8");
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name = "", body = ""]) => ({
    name,
    body,
  }));
  const modelNames = new Set(models.map((model) => model.name));
  /** A model's fields as [name, type] (type without `?` or `[]`). */
  const fieldsOf = (body: string): [string, string][] =>
    [...body.matchAll(/^\s+(\w+)\s+(\w+)(?:\?|\[\])?(?:\s|$)/gm)].map(([, field = "", type = ""]) => [field, type]);

  it("lists exactly the schema's models that have a userId field", () => {
    const withUserId = models
      .filter(({ body }) => fieldsOf(body).some(([field, type]) => field === "userId" && type === "String"))
      .map(({ name }) => name)
      .sort();

    expect([...USER_SCOPED_MODELS, AUDIT_LOG_MODEL].sort()).toEqual(withUserId);
    expect(modelNames.has(USER_MODEL)).toBe(true);
  });

  it("classifies every model in the schema exactly once", () => {
    const classified = [
      USER_MODEL,
      AUDIT_LOG_MODEL,
      ...USER_SCOPED_MODELS,
      ...Object.keys(CHILD_MODELS),
      ...UNOWNED_MODELS,
    ];

    expect([...classified].sort()).toEqual([...modelNames].sort());
    expect(new Set(classified).size).toBe(classified.length);
    for (const name of modelNames) expect(ownershipOf(name), name).toBeDefined();
  });

  it("knows every relation field of every model", () => {
    const relations = Object.fromEntries(
      models.map(({ name, body }) => [
        name,
        Object.fromEntries(fieldsOf(body).filter(([, type]) => modelNames.has(type))),
      ]),
    );

    expect(MODEL_RELATIONS).toEqual(relations);
  });

  it("reaches each child model's owner through a parent that has userId", () => {
    for (const [model, child] of Object.entries(CHILD_MODELS)) {
      expect(MODEL_RELATIONS[model]?.[child.parentRelation], model).toBe(child.parentModel);
      expect(ownershipOf(child.parentModel), model).toBe("scoped");
      const body = models.find(({ name }) => name === model)?.body ?? "";
      expect(
        fieldsOf(body).map(([field]) => field),
        model,
      ).toContain(child.foreignKey);
      expect(
        fieldsOf(body).map(([field]) => field),
        model,
      ).not.toContain("userId");
    }
  });
});
