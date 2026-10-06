# Finlytics — Algo Trading SaaS (kickoff kit)

Professional, multi-broker algorithmic trading platform for Indian markets: TradingView charts, live option chain with
Greeks, strategy builder + code strategies, stockmock-style backtesting, agentic AI orchestrator, alerts, live P&L.

**Start here (in order):**

1. `docs/09-CLAUDE-CODE-WORKFLOW.md` — setup, which model/mode to use, daily loop.
2. `CLAUDE.md` — the master prompt Claude follows.
3. `docs/01-ARCHITECTURE.md` → `02-FOLDER-STRUCTURE.md` → `03-DATABASE-SCHEMA.md` → `04-API-DESIGN.md` → `05-UI-ARCHITECTURE.md` → `06-SECURITY.md` → `07-AGENTIC-ORCHESTRATOR.md`.
4. `docs/08-ROADMAP.md` — build it phase by phase with `/plan-feature` + `/build-feature`.

```
pnpm i && docker compose up -d && pnpm db:migrate && pnpm dev
web http://localhost:3000 · api http://localhost:4000/docs · ai-engine http://localhost:8000/docs
```

Stack: Next.js 15 · shadcn/ui + Tailwind v4 (+ MUI DataGrid) · NestJS 11 · Prisma 7 · PostgreSQL 16 + TimescaleDB ·
Redis 7 · Socket.IO · FastAPI + LangGraph · Auth.js · Docker/K8s.
