CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'PRO', 'ADMIN');

-- CreateEnum
CREATE TYPE "BrokerCode" AS ENUM ('UPSTOX', 'DHAN', 'ZERODHA', 'ANGELONE', 'FYERS', 'SHOONYA', 'PAPER');

-- CreateEnum
CREATE TYPE "BrokerAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'NEEDS_RELOGIN', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "Exchange" AS ENUM ('NSE', 'BSE', 'MCX', 'NFO', 'BFO', 'CDS');

-- CreateEnum
CREATE TYPE "Segment" AS ENUM ('EQ', 'INDEX', 'FUT', 'OPT');

-- CreateEnum
CREATE TYPE "HolidayClosure" AS ENUM ('FULL_DAY', 'MORNING_SESSION', 'EVENING_SESSION');

-- CreateEnum
CREATE TYPE "OptionType" AS ENUM ('CE', 'PE');

-- CreateEnum
CREATE TYPE "Timeframe" AS ENUM ('M1', 'M3', 'M5', 'M15', 'M30', 'H1', 'D1');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT', 'SL', 'SL_M');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('INTRADAY', 'DELIVERY', 'MARGIN', 'CO', 'BO');

-- CreateEnum
CREATE TYPE "Validity" AS ENUM ('DAY', 'IOC');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('MANUAL', 'CHART', 'STRATEGY', 'AGENT', 'BASKET', 'SQUARE_OFF');

-- CreateEnum
CREATE TYPE "StrategyKind" AS ENUM ('NOCODE', 'CODE_TS', 'CODE_PY');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('STARTING', 'RUNNING', 'PAUSED', 'STOPPED', 'ERROR', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BacktestStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('PRICE', 'INDICATOR', 'OPTION_CHAIN', 'PNL', 'AGENT', 'NEWS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'TRIGGERED', 'PAUSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "planId" TEXT,
    "passwordHash" TEXT,
    "totpSecretEnc" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceInrMonthly" DECIMAL(10,2) NOT NULL,
    "maxBrokerAccounts" INTEGER NOT NULL DEFAULT 1,
    "maxWatchlists" INTEGER NOT NULL DEFAULT 3,
    "maxWatchlistItems" INTEGER NOT NULL DEFAULT 50,
    "maxStrategiesLive" INTEGER NOT NULL DEFAULT 1,
    "maxAlerts" INTEGER NOT NULL DEFAULT 10,
    "maxRtSubscriptions" INTEGER NOT NULL DEFAULT 100,
    "backtestMinutesPerDay" INTEGER NOT NULL DEFAULT 30,
    "agentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoTradeEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrokerAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "broker" "BrokerCode" NOT NULL,
    "label" TEXT NOT NULL,
    "brokerClientIdEnc" TEXT NOT NULL,
    "encryptedCredentials" BYTEA NOT NULL,
    "encKeyWrapped" BYTEA NOT NULL,
    "encIv" BYTEA NOT NULL,
    "encKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "BrokerAccountStatus" NOT NULL DEFAULT 'PENDING',
    "tokenExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "algoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "key" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "segment" "Segment" NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isin" TEXT,
    "expiry" DATE,
    "strike" DECIMAL(18,4),
    "optionType" "OptionType",
    "lotSize" INTEGER NOT NULL DEFAULT 1,
    "tickSize" DECIMAL(10,4) NOT NULL DEFAULT 0.05,
    "freezeQty" INTEGER,
    "brokerTokens" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Tick" (
    "instrumentKey" TEXT NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "ltp" DECIMAL(18,4) NOT NULL,
    "volume" BIGINT,
    "oi" BIGINT,
    "bid" DECIMAL(18,4),
    "ask" DECIMAL(18,4),

    CONSTRAINT "Tick_pkey" PRIMARY KEY ("instrumentKey","ts")
);

-- CreateTable
CREATE TABLE "Candle" (
    "instrumentKey" TEXT NOT NULL,
    "timeframe" "Timeframe" NOT NULL,
    "ts" TIMESTAMPTZ(0) NOT NULL,
    "open" DECIMAL(18,4) NOT NULL,
    "high" DECIMAL(18,4) NOT NULL,
    "low" DECIMAL(18,4) NOT NULL,
    "close" DECIMAL(18,4) NOT NULL,
    "volume" BIGINT NOT NULL DEFAULT 0,
    "oi" BIGINT,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("instrumentKey","timeframe","ts")
);

-- CreateTable
CREATE TABLE "OptionChainSnapshot" (
    "underlying" TEXT NOT NULL,
    "expiry" DATE NOT NULL,
    "ts" TIMESTAMPTZ(0) NOT NULL,
    "spot" DECIMAL(18,4) NOT NULL,
    "futPrice" DECIMAL(18,4),
    "rows" JSONB NOT NULL,
    "pcr" DECIMAL(10,4),
    "maxPain" DECIMAL(18,4),

    CONSTRAINT "OptionChainSnapshot_pkey" PRIMARY KEY ("underlying","expiry","ts")
);

-- CreateTable
CREATE TABLE "MarketHoliday" (
    "date" DATE NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "name" TEXT NOT NULL,
    "closure" "HolidayClosure" NOT NULL DEFAULT 'FULL_DAY',

    CONSTRAINT "MarketHoliday_pkey" PRIMARY KEY ("exchange","date")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "instrumentKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "brokerOrderId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "instrumentKey" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "product" "ProductType" NOT NULL,
    "validity" "Validity" NOT NULL DEFAULT 'DAY',
    "qty" INTEGER NOT NULL,
    "filledQty" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4),
    "triggerPrice" DECIMAL(18,4),
    "avgFillPrice" DECIMAL(18,4),
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "source" "OrderSource" NOT NULL DEFAULT 'MANUAL',
    "strategyDeploymentId" TEXT,
    "agentRunId" TEXT,
    "tag" TEXT,
    "isPaper" BOOLEAN NOT NULL DEFAULT false,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "brokerTradeId" TEXT,
    "instrumentKey" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "charges" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "isPaper" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "instrumentKey" TEXT NOT NULL,
    "product" "ProductType" NOT NULL,
    "netQty" INTEGER NOT NULL,
    "buyQty" INTEGER NOT NULL DEFAULT 0,
    "sellQty" INTEGER NOT NULL DEFAULT 0,
    "buyAvg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sellAvg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "realisedPnl" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isPaper" BOOLEAN NOT NULL DEFAULT false,
    "tradingDate" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPnl" (
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isPaper" BOOLEAN NOT NULL DEFAULT false,
    "realised" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "charges" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tradesCount" INTEGER NOT NULL DEFAULT 0,
    "winCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyPnl_pkey" PRIMARY KEY ("userId","date","isPaper")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "StrategyKind" NOT NULL,
    "definition" JSONB NOT NULL,
    "code" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyDeployment" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "isPaper" BOOLEAN NOT NULL DEFAULT true,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'STARTING',
    "params" JSONB NOT NULL DEFAULT '{}',
    "limits" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "StrategyDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyRunEvent" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,

    CONSTRAINT "StrategyRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backtest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "definitionHash" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "BacktestStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "equityCurve" JSONB,
    "dailyPnl" JSONB,
    "tradesUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Backtest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "universe" TEXT[],
    "regime" TEXT,
    "bias" TEXT,
    "plan" JSONB,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "instrumentKey" TEXT,
    "type" TEXT NOT NULL,
    "score" DECIMAL(5,4) NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AgentSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoTradeConfig" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "brokerAccountId" TEXT,
    "isPaper" BOOLEAN NOT NULL DEFAULT true,
    "instruments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxLossDay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "maxOrderValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "maxOpenLots" INTEGER NOT NULL DEFAULT 0,
    "maxTradesDay" INTEGER NOT NULL DEFAULT 0,
    "tradeWindowStart" TEXT NOT NULL DEFAULT '09:20',
    "tradeWindowEnd" TEXT NOT NULL DEFAULT '15:15',
    "minConfidence" DECIMAL(5,4) NOT NULL DEFAULT 0.7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoTradeConfig_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RiskLimit" (
    "userId" TEXT NOT NULL,
    "maxLossDay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "maxOrderValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 0,
    "maxOrdersPerSec" INTEGER NOT NULL DEFAULT 5,
    "maxOrdersPerDay" INTEGER NOT NULL DEFAULT 500,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskLimit_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TradingControl" (
    "userId" TEXT NOT NULL,
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "trippedAt" TIMESTAMP(3),
    "trippedBy" TEXT,

    CONSTRAINT "TradingControl_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GlobalControl" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentKey" TEXT,
    "condition" JSONB NOT NULL,
    "repeat" BOOLEAN NOT NULL DEFAULT false,
    "cooldownSec" INTEGER NOT NULL DEFAULT 60,
    "channels" TEXT[] DEFAULT ARRAY['IN_APP']::TEXT[],
    "action" JSONB,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "lastTriggered" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" JSONB NOT NULL,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "category" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "configEnc" BYTEA NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_planId_idx" ON "User"("planId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "BrokerAccount_userId_status_idx" ON "BrokerAccount"("userId", "status");

-- CreateIndex
CREATE INDEX "BrokerAccount_status_tokenExpiresAt_idx" ON "BrokerAccount"("status", "tokenExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerAccount_userId_broker_label_key" ON "BrokerAccount"("userId", "broker", "label");

-- CreateIndex
CREATE INDEX "Instrument_symbol_segment_expiry_strike_optionType_idx" ON "Instrument"("symbol", "segment", "expiry", "strike", "optionType");

-- CreateIndex
CREATE INDEX "Instrument_exchange_segment_isActive_idx" ON "Instrument"("exchange", "segment", "isActive");

-- CreateIndex
CREATE INDEX "instrument_name_trgm" ON "Instrument" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "instrument_symbol_trgm" ON "Instrument" USING GIN ("symbol" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Candle_timeframe_ts_idx" ON "Candle"("timeframe", "ts");

-- CreateIndex
CREATE INDEX "OptionChainSnapshot_underlying_ts_idx" ON "OptionChainSnapshot"("underlying", "ts");

-- CreateIndex
CREATE INDEX "Watchlist_userId_position_idx" ON "Watchlist"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_userId_name_key" ON "Watchlist"("userId", "name");

-- CreateIndex
CREATE INDEX "WatchlistItem_watchlistId_position_idx" ON "WatchlistItem"("watchlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_instrumentKey_key" ON "WatchlistItem"("watchlistId", "instrumentKey");

-- CreateIndex
CREATE INDEX "Order_userId_placedAt_idx" ON "Order"("userId", "placedAt" DESC);

-- CreateIndex
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");

-- CreateIndex
CREATE INDEX "Order_strategyDeploymentId_idx" ON "Order"("strategyDeploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_brokerAccountId_brokerOrderId_key" ON "Order"("brokerAccountId", "brokerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Trade_userId_executedAt_idx" ON "Trade"("userId", "executedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Trade_brokerAccountId_brokerTradeId_key" ON "Trade"("brokerAccountId", "brokerTradeId");

-- CreateIndex
CREATE INDEX "Position_userId_tradingDate_idx" ON "Position"("userId", "tradingDate");

-- CreateIndex
CREATE UNIQUE INDEX "Position_brokerAccountId_instrumentKey_product_tradingDate__key" ON "Position"("brokerAccountId", "instrumentKey", "product", "tradingDate", "isPaper");

-- CreateIndex
CREATE INDEX "Strategy_userId_updatedAt_idx" ON "Strategy"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Strategy_isTemplate_idx" ON "Strategy"("isTemplate");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_userId_name_key" ON "Strategy"("userId", "name");

-- CreateIndex
CREATE INDEX "StrategyDeployment_strategyId_status_idx" ON "StrategyDeployment"("strategyId", "status");

-- CreateIndex
CREATE INDEX "StrategyDeployment_status_idx" ON "StrategyDeployment"("status");

-- CreateIndex
CREATE INDEX "StrategyRunEvent_deploymentId_ts_idx" ON "StrategyRunEvent"("deploymentId", "ts" DESC);

-- CreateIndex
CREATE INDEX "Backtest_userId_createdAt_idx" ON "Backtest"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Backtest_definitionHash_idx" ON "Backtest"("definitionHash");

-- CreateIndex
CREATE INDEX "AgentRun_userId_startedAt_idx" ON "AgentRun"("userId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AgentSignal_userId_ts_idx" ON "AgentSignal"("userId", "ts" DESC);

-- CreateIndex
CREATE INDEX "AgentSignal_runId_idx" ON "AgentSignal"("runId");

-- CreateIndex
CREATE INDEX "Alert_userId_status_idx" ON "Alert"("userId", "status");

-- CreateIndex
CREATE INDEX "Alert_status_instrumentKey_idx" ON "Alert"("status", "instrumentKey");

-- CreateIndex
CREATE INDEX "AlertEvent_alertId_ts_idx" ON "AlertEvent"("alertId", "ts" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "NotificationChannel_userId_type_idx" ON "NotificationChannel"("userId", "type");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerAccount" ADD CONSTRAINT "BrokerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_instrumentKey_fkey" FOREIGN KEY ("instrumentKey") REFERENCES "Instrument"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_strategyDeploymentId_fkey" FOREIGN KEY ("strategyDeploymentId") REFERENCES "StrategyDeployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPnl" ADD CONSTRAINT "DailyPnl_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyDeployment" ADD CONSTRAINT "StrategyDeployment_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyDeployment" ADD CONSTRAINT "StrategyDeployment_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyRunEvent" ADD CONSTRAINT "StrategyRunEvent_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backtest" ADD CONSTRAINT "Backtest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backtest" ADD CONSTRAINT "Backtest_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSignal" ADD CONSTRAINT "AgentSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSignal" ADD CONSTRAINT "AgentSignal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoTradeConfig" ADD CONSTRAINT "AutoTradeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskLimit" ADD CONSTRAINT "RiskLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingControl" ADD CONSTRAINT "TradingControl_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
