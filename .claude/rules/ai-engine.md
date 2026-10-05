---
description: Rules for apps/ai-engine (Python/FastAPI, LangGraph agents, backtest compute).
globs: ["apps/ai-engine/**"]
---

# AI Engine Rules (Python)

- Python 3.12, `uv` for deps, `ruff` + `mypy --strict`, `pytest`. Pydantic v2 models for every request/response and every agent message.
- FastAPI app is **internal only** (cluster network). Auth: RS256 JWT issued by `apps/api`. No direct DB writes except `AgentRun`, `AgentSignal`, `BacktestResult` tables via SQLAlchemy async.
- Market data read from Redis (`quote:*`, streams) and Timescale — never from brokers.
- Orchestrator = LangGraph `StateGraph`; master agent is the only node allowed to call the `execution` tool, and only when `AutoTradeConfig.enabled` and `RiskService.check()` (called over HTTP to api) passes. Every tool call is logged to `AgentRun.steps` (JSONB).
- LLM calls through a single `llm.py` client with model routing: cheap/fast model for news summarisation, strongest model for the master agent's decision step. Set hard token/cost budgets per run; cache news embeddings.
- Deterministic parts (Greeks, indicators, S/R, orderflow stats) are pure Python/NumPy/Polars functions with unit tests — the LLM reasons over their outputs, it does not compute numbers.
- Backtest engine: event-driven, vectorised per-day; uses 1-min option-chain snapshots; models slippage (configurable bps), STT/exchange/brokerage charges, lot sizes, expiry rollovers; results cached by `(strategyHash, params, dateRange)`.
- Timeouts: every agent step ≤ 20 s; whole scalping loop tick ≤ 500 ms (no LLM in the hot path — LLM sets regime/bias every N seconds, rules engine executes).
