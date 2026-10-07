/**
 * Row builders for integration tests that need user-owned rows. Every user gets a unique email, so tests sharing a
 * database never collide. The builders return unchecked create inputs (plain foreign key ids), so a test can point a
 * row at another user's parent on purpose. Encrypted columns hold obvious dummy bytes: these tests never encrypt
 * anything, and nothing token-like belongs in a fixture.
 */
import type { Prisma, PrismaClient } from "../../src/index";
import { uniqueSuffix } from "./harness";

/** A user and the broker account its trading rows are on. */
export interface Trader {
  readonly userId: string;
  readonly brokerAccountId: string;
}

const INSTRUMENT_KEY = "NSE_EQ|INFY";

/** Creates a user with one paper broker account. */
export async function createTrader(prisma: PrismaClient, name: string): Promise<Trader> {
  const user = await prisma.user.create({ data: { email: `${name}-${uniqueSuffix()}@example.test` } });
  const account = await prisma.brokerAccount.create({
    data: {
      userId: user.id,
      broker: "PAPER",
      label: "paper",
      // Shaped like the vault's output (the vault CHECK): a 48-byte wrapped key, 12-byte IVs, each ciphertext with its IV.
      brokerClientIdEnc: Uint8Array.of(0),
      brokerClientIdIv: new Uint8Array(12),
      encryptedCredentials: Uint8Array.of(0),
      credentialsIv: new Uint8Array(12),
      encKeyWrapped: new Uint8Array(48),
      encKeyIv: new Uint8Array(12),
    },
  });
  return { userId: user.id, brokerAccountId: account.id };
}

/** A paper market order by `trader.userId` on `trader.brokerAccountId`. */
export function marketOrder(trader: Trader, idempotencyKey: string): Prisma.OrderUncheckedCreateInput {
  return {
    ...trader,
    idempotencyKey,
    instrumentKey: INSTRUMENT_KEY,
    side: "BUY",
    type: "MARKET",
    product: "INTRADAY",
    qty: 1,
    isPaper: true,
  };
}

/** A paper fill of `orderId`, by `trader.userId` on `trader.brokerAccountId`. */
export function fill(trader: Trader, orderId: string): Prisma.TradeUncheckedCreateInput {
  return {
    ...trader,
    orderId,
    instrumentKey: INSTRUMENT_KEY,
    side: "BUY",
    qty: 1,
    price: "1500.0000",
    executedAt: new Date(),
    isPaper: true,
  };
}

/** An open paper position of `trader.userId` on `trader.brokerAccountId`. */
export function openPosition(trader: Trader): Prisma.PositionUncheckedCreateInput {
  return {
    ...trader,
    instrumentKey: INSTRUMENT_KEY,
    product: "INTRADAY",
    netQty: 1,
    buyQty: 1,
    buyAvg: "1500.0000",
    isPaper: true,
    tradingDate: new Date("2026-01-02T00:00:00.000Z"),
  };
}

export function strategy(userId: string): Prisma.StrategyUncheckedCreateInput {
  return { userId, name: `strategy-${uniqueSuffix()}`, kind: "NOCODE", definition: {} };
}

/** A paper deployment of `strategyId` by `trader.userId` on `trader.brokerAccountId`. */
export function deployment(trader: Trader, strategyId: string): Prisma.StrategyDeploymentUncheckedCreateInput {
  return { ...trader, strategyId, limits: {} };
}

export function backtest(userId: string, strategyId: string): Prisma.BacktestUncheckedCreateInput {
  return { userId, strategyId, definitionHash: `hash-${uniqueSuffix()}`, params: {} };
}

export function agentRun(userId: string): Prisma.AgentRunUncheckedCreateInput {
  return { userId, mode: "advise", universe: ["NSE_INDEX|NIFTY"] };
}

export function agentSignal(userId: string, runId: string): Prisma.AgentSignalUncheckedCreateInput {
  return { userId, runId, agent: "technical", type: "HOLD", score: "0.5", confidence: "0.5", summary: "test signal" };
}
