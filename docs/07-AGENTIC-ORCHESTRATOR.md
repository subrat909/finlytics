# 07 — Agentic Orchestrator (apps/ai-engine)

## Topology (LangGraph `StateGraph`)
```
                              ┌──────────────── MASTER AGENT ────────────────┐
                              │ merges reports → market regime & bias →      │
                              │ trade plan (or "stand aside") → risk gate →  │
                              │ execution (only if auto-trade ON)            │
                              └──────────────────────────────────────────────┘
        ▲            ▲             ▲              ▲              ▲              ▲             ▲
 ┌──────┴─────┐ ┌────┴─────┐ ┌─────┴─────┐ ┌──────┴──────┐ ┌─────┴──────┐ ┌─────┴──────┐ ┌────┴─────┐
 │ News &     │ │ Global   │ │ Crypto    │ │ Commodities │ │ Option     │ │ Technical  │ │ Orderflow│
 │ Sentiment  │ │ Markets  │ │           │ │ (gold, oil) │ │ Chain &    │ │ (MTF, S/R, │ │ & SMC    │
 │ (RSS, APIs)│ │ (US, Asia│ │ (BTC/ETH  │ │             │ │ Greeks, OI │ │ indicators,│ │ (volume  │
 │            │ │ GIFT)    │ │ risk-on?) │ │             │ │ PCR, IV)   │ │ patterns)  │ │ profile, │
 └────────────┘ └──────────┘ └───────────┘ └─────────────┘ └────────────┘ └────────────┘ │ FVG, OB, │
                                                                                          │ liquidity│
                                                                                          └──────────┘
                                    ┌────────────┐      ┌──────────────┐
                                    │ Risk Agent │      │ Execution    │   ← Scalping loop (rules engine, no LLM,
                                    │ (limits,   │      │ Agent        │     ≤ 500 ms tick): entries/exits per
                                    │ exposure,  │      │ (orders via  │     master's current bias + microstructure
                                    │ VaR)       │      │ api, exits)  │     triggers (VWAP, OI shift, delta, CVD)
                                    └────────────┘      └──────────────┘
```

## Shared state (`AgentState`, Pydantic)
`run_id, user_id, mode(advise|auto), universe[], timeframe, as_of, reports: dict[agent, Report], regime, bias, plan: TradePlan | None, risk_verdict, executions[], messages[]`

Every agent writes a `Report{summary, score(-1..1), confidence, evidence[], ttl}`. Agents can read each other's
reports (blackboard pattern) and post to `messages` (channel visible in UI timeline). Master runs after all
collectors (fan-in), re-runs incrementally when a report's `ttl` expires or an event fires (big OI change, news shock).

## Cadence
| Loop | Frequency | LLM? |
|---|---|---|
| Collectors (news, global, crypto, commodities) | 2–5 min, event-driven on breaking news | yes (summarise + sentiment, cheap model) |
| Analysts (chain, technical, orderflow/SMC) | every candle close (1m/5m) | numerics only; LLM narrates every 5 min |
| Master decision | every 1–5 min or on event | yes (strongest model, structured output `TradePlan`) |
| Execution/scalping loop | 250–500 ms | **no** — deterministic rules from `TradePlan` |
| Risk agent | every tick of execution + pre-trade | no |

## Deterministic toolbox (`app/quant`)
Greeks (Black-76 for index options, Black-Scholes-Merton for stocks), IV solve, IV skew/surface; indicators (EMA/SMA,
VWAP, RSI, MACD, ADX, Supertrend, Bollinger, ATR, Ichimoku); S/R (pivots, volume profile POC/VAH/VAL, swing
clustering, option OI walls); SMC (market structure BOS/CHoCH, order blocks, FVG, liquidity sweeps); orderflow (CVD
from bid/ask aggressor inference, delta divergence, OI-price matrix: long build-up / short covering / etc.).

## Guardrails for auto-trade
- Off by default; enabling requires 2FA + explicit limits: max loss/day, max order value, max open lots, allowed
  instruments, trading window, max trades/day.
- Every plan passes `RiskService.check()` in `apps/api` (source of truth) before execution; api can veto.
- Hard stop-loss attached to every entry; time stop (exit before 15:20 IST); kill switch stops loop immediately.
- Paper mode replays the same loop against live data with simulated fills — mandatory for 5 trading days before live.
- All reasoning steps stored (`AgentRun.steps`) for review in UI.

## Honest expectations (surface these in UI)
Latency floor is broker API latency (~50–300 ms). Agents provide decision support and rule-based automation; no
model guarantees profits. Backtest ≠ live; slippage/charges modelled but regime changes are not predictable.
