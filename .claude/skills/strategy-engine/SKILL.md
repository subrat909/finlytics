---
name: strategy-engine
description: How strategies are represented, validated, executed and backtested in Finlytics (no-code JSON DSL + code strategies, sandboxing, backtest contract). Use when working on strategies, backtests or the agent execution loop.
---

# Strategy Engine Skill

## Representation
- `Strategy.definition` is JSON validated by `StrategyDefinitionSchema` (`packages/shared/src/strategy.ts`):
  `{ kind: "nocode" | "code", universe, timeframe, entry: Condition[], exit: Condition[], legs: OptionLeg[], risk: {sl, tp, trailing, maxLossDay, maxPositions}, schedule: {start, end, squareOff, days} }`
- Conditions are a small expression tree: `{ op: "crossover", a: Indicator, b: Indicator }`, `{ op: ">", a, b }`, `and/or/not`. Indicators: `{ name: "ema", params: {period: 20}, source: "close" }`, plus option-chain fields (`iv`, `delta`, `oi`, `pcr`).
- Code strategies: TypeScript (`isolated-vm`) or Python (sandboxed worker). Exposed API: `ctx.candles(key, tf, n)`, `ctx.chain(underlying, expiry)`, `ctx.indicator(...)`, `ctx.buy/sell/exit(...)`, `ctx.log()`. No `fetch`, no `require`.

## Live execution
`StrategyRunner` (BullMQ worker, one job per deployed strategy) evaluates on candle close / tick (configurable), calls `OrderService` through `RiskService` + kill switch, persists `StrategyRun` events, publishes to `user:<id>` room.

## Backtest contract (ai-engine `/backtest`)
Input: definition + date range + capital + slippage bps + charges profile. Output: trades[], equity curve, metrics (net P&L, max DD, win rate, expectancy, Sharpe, profit factor), per-day P&L calendar, per-leg stats. Must use 1-min option-chain snapshots; expiries rolled per NSE calendar; results cached by hash.
