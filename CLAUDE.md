# Finlytics — Master Project Context (CLAUDE.md)

> Read this file completely before touching any code. It is the single source of truth for how this
> project is built. Detailed rules live in `.claude/rules/`; design decisions live in `docs/`.

## 1. What Finlytics is

Finlytics is a production-grade, multi-tenant SaaS **algorithmic trading platform for the Indian market**
(NSE/BSE cash, F&O, MCX). Reference products: algorooms.in, algotest.in, stockmock.in, algocrab.
Core capabilities:

1. Multi-broker, one-time broker login (Upstox + Dhan first; adapter pattern for any broker).
2. Real-time TradingView charts (Advanced Charts library) with on-chart alerts and one-click/auto trade.
3. Real-time option chain with Greeks (IV, Delta, Gamma, Theta, Vega, Rho) + PCR/OI analytics.
4. Real-time quotes for any instrument, custom watchlists.
5. Strategy builder (no-code logic builder like algorooms + code editor in TypeScript/Python).
6. Backtest & simulation on historical option-chain data (stockmock-like) with realistic fills, slippage, charges.
7. Agentic AI orchestrator (Python/FastAPI): master agent + specialised agents (news, global macro, crypto,
   commodities, option-chain/Greeks, technical/SMC/orderflow, risk, execution). Agents advise and, when the user
   explicitly enables auto-trade with risk limits, execute and exit in real time.
8. Alerts & notifications (price, indicator, option-chain, P&L, agent signals) via in-app, push, email, Telegram.
9. Real-time P&L, orders, positions, holdings, funds, trade history, P&L calendar.
10. Settings page controlling the whole app; OAuth2 login (Google, GitHub, Email magic link) with Auth.js.

## 2. Tech stack (do not deviate without updating this file)

| Layer        | Choice                                                                                   |
|--------------|------------------------------------------------------------------------------------------|
| Monorepo     | pnpm workspaces + Turborepo                                                               |
| Frontend     | Next.js 15 (App Router, RSC), React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui, MUI (icons + data-grid only), TanStack Query, Zustand, Zod, react-hook-form, lucide-react |
| Charts       | TradingView Advanced Charts (vendored, licensed) with our UDF-compatible datafeed; Lightweight Charts fallback |
| Backend API  | NestJS 11 (Fastify adapter), Prisma 7, Zod DTO validation, BullMQ (Redis) jobs, Socket.IO gateway (uWS engine) |
| Realtime     | Redis Streams + Pub/Sub for tick fan-out; **max 1 broker market WS + 1 broker order WS per broker on the server, 1 client WS per browser tab** |
| Database     | PostgreSQL 16 + TimescaleDB extension (ticks, candles, option-chain snapshots are hypertables) |
| Cache        | Redis 7 (quotes cache, sessions, rate limits, queues)                                     |
| AI / ML      | Python 3.12, FastAPI, LangGraph for the multi-agent orchestrator, Pydantic v2, NumPy/Pandas/Polars, py_vollib for Greeks |
| Auth         | Auth.js v5 (Google, GitHub, Email), DB sessions, JWT only for service-to-service          |
| Secrets      | Broker tokens encrypted at rest with AES-256-GCM via envelope encryption (KMS/Vault master key); never logged |
| Infra        | Docker Compose (dev) → Kubernetes (prod), Nginx/Traefik ingress, Cloudflare in front, GitHub Actions CI |
| Observability| OpenTelemetry → Grafana/Loki/Tempo, Prometheus, Sentry                                  |

## 3. Repository layout (summary — full version in `docs/02-FOLDER-STRUCTURE.md`)

```
apps/web         Next.js frontend
apps/api         NestJS backend (REST + WebSocket gateway + workers)
apps/ai-engine   FastAPI: agents, ML models, backtest compute (CPU-heavy)
packages/database  Prisma schema, migrations, seed
packages/shared    Zod schemas, types, constants shared by web + api
packages/ui        Design system (tokens, shadcn components, charts wrappers)
packages/broker-sdk  Broker adapter interface + Upstox/Dhan implementations
infra/           docker, k8s, nginx, grafana
docs/            architecture decisions (read before building a feature)
```

## 4. Non-negotiable engineering rules

### Security (full list: `.claude/rules/security.md`)
- Broker API keys/secrets/tokens are **never** sent to the browser, never logged, never in URLs. Stored encrypted (AES-256-GCM, per-row data key, master key from env/KMS).
- All input validated with Zod at the boundary (controllers, server actions, WS handlers). No raw SQL string interpolation — Prisma only; `$queryRaw` only with tagged templates.
- Auth: DB sessions with httpOnly, Secure, SameSite=Lax cookies; CSRF on mutations; rate limiting per IP + per user; account lockout; 2FA (TOTP) available.
- Every trading mutation (order place/modify/cancel, auto-trade enable) requires an idempotency key and is written to an append-only `AuditLog`.
- Kill switch: a single flag (`TradingControl.killSwitch`) stops all automated order flow for a user or globally.
- Secrets only via environment variables; `.env*` is gitignored; `.env.example` documents every variable.

### Broker API budget
- The platform uses **at most 12 broker REST endpoints** per broker (see `docs/04-API-DESIGN.md` §3). Everything else (quotes, option chain, charts, watchlist) is served from our own Redis/Timescale cache fed by **one** shared market-data WebSocket per broker.
- Never poll a broker REST endpoint in a loop. Instrument master downloaded once per day. Rate limits enforced by `BrokerRateLimiter` (token bucket in Redis).

### Performance
- Client subscribes to instruments via one Socket.IO connection; server coalesces ticks (max 10 updates/sec/instrument to UI) and sends binary-packed diffs.
- Server components by default; `"use client"` only for interactive leaves. Virtualise all long lists (TanStack Virtual). Memoise row renderers. No layout thrash in tick handlers (update via refs/zustand selectors, not context).
- Every subscription (WS, interval, observer) is cleaned up in `useEffect` return. ESLint rule `react-hooks/exhaustive-deps` is an error.

### Code quality
- TypeScript `strict: true`, no `any` (use `unknown` + narrowing). ESLint + Prettier enforced in CI.
- Each NestJS module: `controller` → `service` → `repository`; DTOs are Zod schemas from `packages/shared`.
- Tests: unit (Vitest/Jest), integration (Testcontainers Postgres), e2e (Playwright) for critical flows (login, broker connect, place order, strategy deploy). Minimum 80% on `apps/api` services.
- Conventional Commits. Small PRs. Every PR runs `/review` and `/security-audit` commands.

### UI (full spec: `.claude/rules/frontend.md`, `docs/05-UI-ARCHITECTURE.md`)
- Design tokens only (no hard-coded colours). Light + dark via `data-theme`. **No borders or shadows on buttons/inputs**; use filled surfaces (`bg-surface-2`) and focus rings for affordance.
- Every page implements: loading skeleton matching layout shape, empty state with icon + CTA, error state with retry, responsive (mobile ≥ 360px), keyboard navigation + ARIA.
- Sidebar collapse is a CSS-width transition on a persisted Zustand store; it must not re-mount page content.
- Icons: lucide-react; colourful semantic accents (profit green, loss rose, warning amber, info sky, primary indigo).

## 5. Commands you (Claude) should use

```
pnpm i                     install
pnpm dev                   turbo dev (web :3000, api :4000, ai-engine :8000)
pnpm db:migrate            prisma migrate dev (args pass through: pnpm db:migrate --create-only --name <name>)
pnpm db:seed               prisma db seed (idempotent; safe to re-run)
pnpm db:status / db:deploy prisma migrate status / deploy
pnpm db:studio             prisma studio
pnpm format:check / pnpm lint / pnpm typecheck / pnpm test
pnpm test:integration      Testcontainers integration tests (needs Docker)
pnpm check:pkg             publint + attw + require/import smoke tests on built packages
docker compose up -d       postgres+timescale, redis, mailpit (grafana/prometheus: --profile observability)
```

## 6. How to work in this repo (for Claude)

1. Start every feature with `/plan-feature <name>`; wait for approval before writing code.
2. Read the relevant `docs/*.md` and `.claude/rules/*.md` before implementing.
3. Prefer editing existing modules over creating parallel ones. Search before creating.
4. After implementing: run typecheck, lint, tests; then `/review` and, for anything touching auth/broker/orders, `/security-audit`.
5. Never commit secrets, never disable a security rule to make a test pass, never widen CORS to `*`.
6. When unsure about a broker endpoint, read `packages/broker-sdk/README.md` and the official docs link there; do not guess field names.

## 7. Regulatory & reality notes (India)

- SEBI's algo-trading framework for retail (2025) requires broker-registered algos, static IP whitelisting for API orders, and order-rate caps. Design for `algoId` tagging on orders and a per-second order throttle.
- Retail broker REST/WebSocket latency is ~50–300 ms; "HFT" here means **low-latency scalping**, not co-located microsecond HFT. Say so in UI copy.
- Auto-trading by AI agents is opt-in per strategy, bounded by hard risk limits (max loss/day, max positions, max order value), and defaults to paper trading.
