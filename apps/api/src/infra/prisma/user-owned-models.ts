/**
 * What the tenancy guard (./tenancy.extension.ts) knows about each model: who owns its rows, and where its relation
 * fields lead. Kept equal to packages/database/prisma/schema.prisma by the sync tests in
 * __tests__/tenancy.extension.test.ts: a new model, a new `userId` column or a new relation fails them until it is
 * classified here. The guard refuses a model it doesn't know.
 *
 * | Kind     | Models                              | Scope the guard requires                                       |
 * |----------|-------------------------------------|----------------------------------------------------------------|
 * | user     | `User`                              | `where.id`                                                     |
 * | scoped   | {@link USER_SCOPED_MODELS}          | `where.userId` (or a compound key with it); creates set it     |
 * | audit    | `AuditLog`                          | reads: `where.userId` or `where.actorId`; creates only         |
 * | child    | {@link CHILD_MODELS}                | `where.<parent>.userId`; creates connect a parent scoped by it  |
 * | unowned  | {@link UNOWNED_MODELS}              | none, but no relation path from them may reach an owned model  |
 */

/** The User model, scoped by its own `id`. */
export const USER_MODEL = "User";

/** Append-only; its `userId` names the subject of an action (another user, for admin actions). */
export const AUDIT_LOG_MODEL = "AuditLog";

/** Models with a `userId` column: every read, update and delete must filter by it, every create must set it. */
export const USER_SCOPED_MODELS: readonly string[] = Object.freeze([
  "Account",
  "AgentRun",
  "AgentSignal",
  "Alert",
  "ApiKey",
  "AutoTradeConfig",
  "Backtest",
  "BrokerAccount",
  "DailyPnl",
  "Notification",
  "NotificationChannel",
  "Order",
  "Position",
  "RiskLimit",
  "Session",
  "Strategy",
  "StrategyDeployment",
  "Trade",
  "TradingControl",
  "Watchlist",
]);

/** A user-owned model without a `userId` column: it belongs to whoever owns its parent row. */
export interface ChildModel {
  /** The relation field that leads to the parent (`watchlist`). */
  readonly parentRelation: string;
  /** The parent model, which has a `userId` column (`Watchlist`). */
  readonly parentModel: string;
  /** The scalar foreign key to the parent (`watchlistId`): it can't prove ownership, so it is never enough. */
  readonly foreignKey: string;
}

export const CHILD_MODELS: Readonly<Record<string, ChildModel>> = Object.freeze({
  AlertEvent: Object.freeze({ parentRelation: "alert", parentModel: "Alert", foreignKey: "alertId" }),
  StrategyRunEvent: Object.freeze({
    parentRelation: "deployment",
    parentModel: "StrategyDeployment",
    foreignKey: "deploymentId",
  }),
  WatchlistItem: Object.freeze({ parentRelation: "watchlist", parentModel: "Watchlist", foreignKey: "watchlistId" }),
});

/** Models no user owns: reference and market data, platform singletons, Auth.js verification tokens. */
export const UNOWNED_MODELS: readonly string[] = Object.freeze([
  "Candle",
  "GlobalControl",
  "Instrument",
  "InstrumentBrokerToken",
  "MarketHoliday",
  "OptionChainSnapshot",
  "Plan",
  "Tick",
  "VerificationToken",
]);

/** Every relation field of every model, and the model it leads to. Models without relations map to `{}`. */
export const MODEL_RELATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  Account: { user: "User" },
  AgentRun: { user: "User", signals: "AgentSignal", orders: "Order" },
  AgentSignal: { user: "User", run: "AgentRun" },
  Alert: { user: "User", history: "AlertEvent" },
  AlertEvent: { alert: "Alert" },
  ApiKey: { user: "User" },
  AuditLog: {},
  AutoTradeConfig: { user: "User", brokerAccount: "BrokerAccount" },
  Backtest: { user: "User", strategy: "Strategy" },
  BrokerAccount: {
    user: "User",
    orders: "Order",
    positions: "Position",
    trades: "Trade",
    strategyDeployments: "StrategyDeployment",
    autoTradeConfigs: "AutoTradeConfig",
  },
  Candle: {},
  DailyPnl: { user: "User" },
  GlobalControl: {},
  Instrument: { watchlistItems: "WatchlistItem", tokens: "InstrumentBrokerToken" },
  InstrumentBrokerToken: { instrument: "Instrument" },
  MarketHoliday: {},
  Notification: { user: "User" },
  NotificationChannel: { user: "User" },
  OptionChainSnapshot: {},
  Order: {
    user: "User",
    brokerAccount: "BrokerAccount",
    deployment: "StrategyDeployment",
    agentRun: "AgentRun",
    trades: "Trade",
  },
  Plan: { users: "User" },
  Position: { user: "User", brokerAccount: "BrokerAccount" },
  RiskLimit: { user: "User" },
  Session: { user: "User" },
  Strategy: { user: "User", deployments: "StrategyDeployment", backtests: "Backtest" },
  StrategyDeployment: {
    user: "User",
    strategy: "Strategy",
    brokerAccount: "BrokerAccount",
    orders: "Order",
    runs: "StrategyRunEvent",
  },
  StrategyRunEvent: { deployment: "StrategyDeployment" },
  Tick: {},
  Trade: { user: "User", brokerAccount: "BrokerAccount", order: "Order" },
  TradingControl: { user: "User" },
  User: {
    plan: "Plan",
    accounts: "Account",
    sessions: "Session",
    brokerAccounts: "BrokerAccount",
    watchlists: "Watchlist",
    strategies: "Strategy",
    deployments: "StrategyDeployment",
    orders: "Order",
    positions: "Position",
    trades: "Trade",
    alerts: "Alert",
    notifications: "Notification",
    channels: "NotificationChannel",
    backtests: "Backtest",
    agentRuns: "AgentRun",
    agentSignals: "AgentSignal",
    autoTradeConfig: "AutoTradeConfig",
    riskLimit: "RiskLimit",
    tradingControl: "TradingControl",
    dailyPnls: "DailyPnl",
    apiKeys: "ApiKey",
  },
  VerificationToken: {},
  Watchlist: { user: "User", items: "WatchlistItem" },
  WatchlistItem: { watchlist: "Watchlist", instrument: "Instrument" },
});

export type ModelOwnership = "user" | "scoped" | "audit" | "child" | "unowned";

const SCOPED: ReadonlySet<string> = new Set(USER_SCOPED_MODELS);
const UNOWNED: ReadonlySet<string> = new Set(UNOWNED_MODELS);

/** How `model`'s rows are owned, or undefined for a model this file doesn't know. */
export function ownershipOf(model: string): ModelOwnership | undefined {
  if (model === USER_MODEL) return "user";
  if (model === AUDIT_LOG_MODEL) return "audit";
  if (SCOPED.has(model)) return "scoped";
  if (Object.hasOwn(CHILD_MODELS, model)) return "child";
  if (UNOWNED.has(model)) return "unowned";
  return undefined;
}
