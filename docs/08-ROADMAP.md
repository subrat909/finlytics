# 08 — Build Roadmap (step by step, PR-sized)

Each phase ends with something you can open in a browser. Use `/plan-feature` → review → `/build-feature` for every
numbered item. Estimated effort assumes Claude Code doing most of the typing and you reviewing.

## Phase 0 — Foundations (week 1)
0.1 Monorepo scaffold: pnpm + Turborepo, `packages/config` (eslint/tsconfig/prettier), husky, CI skeleton.
0.2 `packages/database`: Prisma schema (this kit) + first migration + Timescale SQL migration + seed (plans, holidays).
0.3 `packages/shared`: Zod schemas for User settings, Instrument key helpers, Money helpers, error codes.
0.4 `packages/ui`: tokens.css, Tailwind theme, shadcn init, Button/Input/Card/Skeleton/EmptyState/ErrorState/PageLoader, Storybook, theme toggle.
0.5 `apps/api` bootstrap: Nest + Fastify, env schema, Prisma/Redis services, health, problem+json filter, pino redaction, OpenAPI at `/docs`, rate-limit + idempotency interceptors.
0.6 `apps/web` bootstrap: App Router, Auth.js (Google/GitHub/Email), AppShell (sidebar smooth collapse, topbar, ⌘K), login page.
✅ Demo: log in, see empty dashboard in light/dark, sidebar toggles smoothly.

## Phase 1 — Brokers & market data (weeks 2–3)
1.1 `packages/broker-sdk`: adapter contract (this kit), rate limiter, circuit breaker, Paper adapter.
1.2 Upstox adapter: OAuth connect flow, vault encryption, profile/funds, instrument master job.
1.3 Dhan adapter: token paste flow, profile/funds, instrument master.
1.4 Market-feed worker: leader election, Upstox feed → Redis; subscriptions ref-count; gateway `/rt` with `sub/unsub`.
1.5 Web: Brokers page (cards, add wizard, relogin banner), Watchlists page with live `PriceCell`.
1.6 Candles: historical backfill via adapter → Timescale; `/v1/candles`; TradingView UDF endpoints; Charts page with Advanced Charts (dynamic import) + Lightweight fallback.
✅ Demo: connect Upstox, watch NIFTY ticks live, open a chart with indicators.

## Phase 2 — Trading core (weeks 4–5)
2.1 Orders module: place/modify/cancel through RiskService + kill switch + idempotency + audit; order feed → DB → `user:<id>` room.
2.2 Positions/holdings/funds, exit & exit-all; live P&L computation from Redis quotes.
2.3 Web: Order ticket (from chart & watchlist), Orders/Positions DataGrid, P&L page with calendar heatmap, `DailyPnl` job.
2.4 Alerts: price/indicator alerts evaluator worker, notifications module (in-app, web push, email, Telegram), Alerts page.
✅ Demo: place a paper and a live order, see fills and P&L update in real time, get a price alert on phone.

## Phase 3 — Option chain & analytics (week 6)
3.1 Option-chain builder: strike window around ATM, feed subscriptions by expiry, Greeks from broker/ai-engine, 1-min snapshot job to Timescale.
3.2 Web: Option Chain page (virtualised, OI bars, Greeks toggle, PCR/max pain strip, add-leg drawer).
3.3 Markets page: indices, movers, FII/DII, global/crypto/commodities collectors (ai-engine).
✅ Demo: live chain with Greeks, build a 4-leg iron condor from the chain.

## Phase 4 — Strategies & backtesting (weeks 7–9)
4.1 Strategy DSL + validator (`packages/shared`), templates (straddle, strangle, iron condor, EMA crossover, ORB).
4.2 No-code builder UI (universe → conditions → legs → risk → schedule) + Monaco code editor with sandbox validation.
4.3 Strategy runner worker (paper first), deployments page with live run log.
4.4 ai-engine backtest engine on `OptionChainSnapshot` (fills, slippage, charges, expiry calendar) + metrics + results UI (equity curve, calendar, trades).
✅ Demo: backtest a 9:20 short straddle over 6 months, deploy it in paper mode.

## Phase 5 — Agentic orchestrator (weeks 10–12)
5.1 ai-engine LangGraph skeleton: state, master, collectors (news/global/crypto/commodities) with cheap-model sentiment.
5.2 Analyst agents: option-chain, technical (MTF + S/R), orderflow/SMC — deterministic quant toolbox + narration.
5.3 Risk + execution agents; `/v1/agents/*`; signals stream → UI timeline; advise mode.
5.4 Auto-trade (paper mandatory first): config + limits + 2FA step-up; scalping rules loop (no LLM on hot path).
5.5 Web: AI Agents page (orchestrator view, run detail with reasoning steps, auto-trade panel).
✅ Demo: agents publish a bias + plan every few minutes; paper auto-trade runs inside limits.

## Phase 6 — Hardening & launch (weeks 13–14)
6.1 Settings page complete (profile, security/2FA/sessions, trading defaults, risk limits, notifications, appearance, billing, danger zone).
6.2 Security audit (`/security-audit` on whole repo), pen-test checklist, DPDP export/delete, SEBI algo tagging + static IP.
6.3 Performance: `/perf-check`, bundle budget, heap-growth e2e, load test gateway (k6: 5k WS clients).
6.4 Infra: Dockerfiles, K8s manifests, GitHub Actions, Grafana dashboards, alerting, backups, runbooks.
6.5 Marketing/pricing page, plans & Razorpay billing (optional).
✅ Launch to a closed beta.
