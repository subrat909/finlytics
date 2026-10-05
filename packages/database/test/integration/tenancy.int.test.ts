import { beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../src/index";
import {
  agentRun,
  agentSignal,
  backtest,
  createTrader,
  deployment,
  fill,
  marketOrder,
  openPosition,
  strategy,
} from "./fixtures";
import type { Trader } from "./fixtures";
import { connect, databaseError, sharedDatabaseUrl, uniqueSuffix } from "./harness";
import type { DatabaseError } from "./harness";

/** SQLSTATE foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = "23503";

/** What inserting a row whose foreign key matches no parent row reports. */
function insertViolation(table: string, constraint: string): DatabaseError {
  return {
    prismaCode: "P2003",
    sqlState: FOREIGN_KEY_VIOLATION,
    message: `insert or update on table "${table}" violates foreign key constraint "${constraint}"`,
  };
}

/** What deleting a parent row that a NO ACTION foreign key still references reports. */
function deleteViolation(parent: string, constraint: string, child: string): DatabaseError {
  return {
    prismaCode: "P2003",
    sqlState: FOREIGN_KEY_VIOLATION,
    message: `update or delete on table "${parent}" violates foreign key constraint "${constraint}" on table "${child}"`,
  };
}

/** The database error behind a query that must fail. Throws if the query succeeds. */
async function rejection(query: PromiseLike<unknown>): Promise<DatabaseError> {
  try {
    await query;
  } catch (error: unknown) {
    return databaseError(error);
  }
  throw new Error("Expected the query to be rejected, but it succeeded");
}

/** A foreign key as the catalog describes it. */
interface ForeignKey {
  name: string;
  columns: string[];
  references: string;
  referencedColumns: string[];
  onDelete: string;
}

/** Tenancy binding: the database itself keeps every relation between user-owned rows within one user. */
describe("tenancy (composite foreign keys on id and userId)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = connect(sharedDatabaseUrl());
    return async () => {
      await prisma.$disconnect();
    };
  });

  it("includes userId on both sides of every foreign key between user-owned tables", async () => {
    // Every foreign key whose own table and referenced table both have a userId column (references to User aside).
    // A relation added later without the composite key shows up here as a key without userId.
    const keys = await prisma.$queryRaw<ForeignKey[]>`
      SELECT c.conname::text AS name,
             ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
             parent.relname::text AS "references",
             ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord)
               AS "referencedColumns",
             CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                                WHEN 'n' THEN 'SET NULL' ELSE 'SET DEFAULT' END AS "onDelete"
      FROM pg_constraint c
      JOIN pg_class parent ON parent.oid = c.confrelid
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND parent.relname <> 'User'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'userId' AND a.attnum > 0
                    AND NOT a.attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attname = 'userId' AND a.attnum > 0
                    AND NOT a.attisdropped)
      ORDER BY c.conname::text COLLATE "C"`;

    const key = (name: string, column: string, references: string, onDelete: string): ForeignKey => ({
      name,
      columns: [column, "userId"],
      references,
      referencedColumns: ["id", "userId"],
      onDelete,
    });
    expect(keys).toEqual([
      key("AgentSignal_runId_userId_fkey", "runId", "AgentRun", "CASCADE"),
      key("AutoTradeConfig_brokerAccountId_userId_fkey", "brokerAccountId", "BrokerAccount", "NO ACTION"),
      key("Backtest_strategyId_userId_fkey", "strategyId", "Strategy", "CASCADE"),
      key("Order_agentRunId_userId_fkey", "agentRunId", "AgentRun", "NO ACTION"),
      key("Order_brokerAccountId_userId_fkey", "brokerAccountId", "BrokerAccount", "CASCADE"),
      key("Order_strategyDeploymentId_userId_fkey", "strategyDeploymentId", "StrategyDeployment", "NO ACTION"),
      key("Position_brokerAccountId_userId_fkey", "brokerAccountId", "BrokerAccount", "CASCADE"),
      key("StrategyDeployment_brokerAccountId_userId_fkey", "brokerAccountId", "BrokerAccount", "CASCADE"),
      key("StrategyDeployment_strategyId_userId_fkey", "strategyId", "Strategy", "CASCADE"),
      key("Trade_brokerAccountId_userId_fkey", "brokerAccountId", "BrokerAccount", "CASCADE"),
      key("Trade_orderId_userId_fkey", "orderId", "Order", "CASCADE"),
    ]);
  });

  it("rejects an order, trade or position on another user's broker account", async () => {
    const alice = await createTrader(prisma, "alice");
    const bob = await createTrader(prisma, "bob");
    const bobsOrder = await prisma.order.create({ data: marketOrder(bob, `order-${uniqueSuffix()}`) });
    // Bob's rows, but on Alice's broker account: (brokerAccountId, userId) matches no broker account.
    const bobOnAlicesAccount: Trader = { userId: bob.userId, brokerAccountId: alice.brokerAccountId };

    const rejected = {
      order: await rejection(prisma.order.create({ data: marketOrder(bobOnAlicesAccount, `order-${uniqueSuffix()}`) })),
      trade: await rejection(prisma.trade.create({ data: fill(bobOnAlicesAccount, bobsOrder.id) })),
      position: await rejection(prisma.position.create({ data: openPosition(bobOnAlicesAccount) })),
    };
    // Control: the same rows on Bob's own broker account are accepted.
    const accepted = {
      order: await prisma.order.create({ data: marketOrder(bob, `order-${uniqueSuffix()}`) }),
      trade: await prisma.trade.create({ data: fill(bob, bobsOrder.id) }),
      position: await prisma.position.create({ data: openPosition(bob) }),
    };

    expect(rejected).toEqual({
      order: insertViolation("Order", "Order_brokerAccountId_userId_fkey"),
      trade: insertViolation("Trade", "Trade_brokerAccountId_userId_fkey"),
      position: insertViolation("Position", "Position_brokerAccountId_userId_fkey"),
    });
    expect(accepted).toMatchObject({ order: bob, trade: bob, position: bob });
    const onAlicesAccount = { where: { brokerAccountId: alice.brokerAccountId } };
    expect([
      await prisma.order.count(onAlicesAccount),
      await prisma.trade.count(onAlicesAccount),
      await prisma.position.count(onAlicesAccount),
    ]).toEqual([0, 0, 0]);
  });

  it("rejects deployments, backtests and agent signals that reference another user's strategy or run", async () => {
    const alice = await createTrader(prisma, "alice");
    const bob = await createTrader(prisma, "bob");
    const alicesStrategy = await prisma.strategy.create({ data: strategy(alice.userId) });
    const alicesRun = await prisma.agentRun.create({ data: agentRun(alice.userId) });
    const bobsStrategy = await prisma.strategy.create({ data: strategy(bob.userId) });
    const bobsRun = await prisma.agentRun.create({ data: agentRun(bob.userId) });

    // Bob's rows (deployed on his own broker account) pointing at Alice's strategy and run.
    const rejected = {
      deployment: await rejection(prisma.strategyDeployment.create({ data: deployment(bob, alicesStrategy.id) })),
      backtest: await rejection(prisma.backtest.create({ data: backtest(bob.userId, alicesStrategy.id) })),
      signal: await rejection(prisma.agentSignal.create({ data: agentSignal(bob.userId, alicesRun.id) })),
    };
    // Control: the same rows pointing at Bob's own strategy and run are accepted.
    const accepted = {
      deployment: await prisma.strategyDeployment.create({ data: deployment(bob, bobsStrategy.id) }),
      backtest: await prisma.backtest.create({ data: backtest(bob.userId, bobsStrategy.id) }),
      signal: await prisma.agentSignal.create({ data: agentSignal(bob.userId, bobsRun.id) }),
    };

    expect(rejected).toEqual({
      deployment: insertViolation("StrategyDeployment", "StrategyDeployment_strategyId_userId_fkey"),
      backtest: insertViolation("Backtest", "Backtest_strategyId_userId_fkey"),
      signal: insertViolation("AgentSignal", "AgentSignal_runId_userId_fkey"),
    });
    expect(accepted).toMatchObject({
      deployment: { userId: bob.userId, strategyId: bobsStrategy.id },
      backtest: { userId: bob.userId, strategyId: bobsStrategy.id },
      signal: { userId: bob.userId, runId: bobsRun.id },
    });
    expect([
      await prisma.strategyDeployment.count({ where: { strategyId: alicesStrategy.id } }),
      await prisma.backtest.count({ where: { strategyId: alicesStrategy.id } }),
      await prisma.agentSignal.count({ where: { runId: alicesRun.id } }),
    ]).toEqual([0, 0, 0]);
  });

  it("deletes a user with orders, trades, deployments and auto-trade config in one statement", async () => {
    const alice = await createTrader(prisma, "alice");
    const { userId, brokerAccountId } = alice;
    const alicesStrategy = await prisma.strategy.create({ data: strategy(userId) });
    const alicesDeployment = await prisma.strategyDeployment.create({ data: deployment(alice, alicesStrategy.id) });
    const alicesRun = await prisma.agentRun.create({ data: agentRun(userId) });
    // The order links to the deployment and the run through the optional, NO ACTION foreign keys.
    const order = await prisma.order.create({
      data: {
        ...marketOrder(alice, `order-${uniqueSuffix()}`),
        strategyDeploymentId: alicesDeployment.id,
        agentRunId: alicesRun.id,
      },
    });
    await prisma.trade.create({ data: fill(alice, order.id) });
    await prisma.position.create({ data: openPosition(alice) });
    await prisma.strategyRunEvent.create({
      data: { deploymentId: alicesDeployment.id, level: "info", message: "test" },
    });
    await prisma.backtest.create({ data: backtest(userId, alicesStrategy.id) });
    await prisma.agentSignal.create({ data: agentSignal(userId, alicesRun.id) });
    // The other NO ACTION foreign key: the auto-trade config names the broker account.
    await prisma.autoTradeConfig.create({ data: { userId, brokerAccountId } });

    // Control: NO ACTION is in force. Deleting any of these parents on its own would leave a reference behind.
    const deletedAlone = {
      brokerAccount: await rejection(prisma.brokerAccount.delete({ where: { id: brokerAccountId } })),
      strategy: await rejection(prisma.strategy.delete({ where: { id: alicesStrategy.id } })),
      agentRun: await rejection(prisma.agentRun.delete({ where: { id: alicesRun.id } })),
    };

    // One statement: its cascades remove the referencing rows too, before NO ACTION is checked at its end.
    const deletedUsers = await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${userId}`;

    expect(deletedAlone).toEqual({
      brokerAccount: deleteViolation("BrokerAccount", "AutoTradeConfig_brokerAccountId_userId_fkey", "AutoTradeConfig"),
      strategy: deleteViolation("StrategyDeployment", "Order_strategyDeploymentId_userId_fkey", "Order"),
      agentRun: deleteViolation("AgentRun", "Order_agentRunId_userId_fkey", "Order"),
    });
    expect(deletedUsers).toBe(1);
    const owned = { where: { userId } };
    expect({
      brokerAccounts: await prisma.brokerAccount.count(owned),
      strategies: await prisma.strategy.count(owned),
      deployments: await prisma.strategyDeployment.count(owned),
      runEvents: await prisma.strategyRunEvent.count({ where: { deploymentId: alicesDeployment.id } }),
      orders: await prisma.order.count(owned),
      trades: await prisma.trade.count(owned),
      positions: await prisma.position.count(owned),
      backtests: await prisma.backtest.count(owned),
      agentRuns: await prisma.agentRun.count(owned),
      agentSignals: await prisma.agentSignal.count(owned),
      autoTradeConfigs: await prisma.autoTradeConfig.count(owned),
    }).toEqual({
      brokerAccounts: 0,
      strategies: 0,
      deployments: 0,
      runEvents: 0,
      orders: 0,
      trades: 0,
      positions: 0,
      backtests: 0,
      agentRuns: 0,
      agentSignals: 0,
      autoTradeConfigs: 0,
    });
  });
});
