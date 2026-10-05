# 02 — Folder Structure (pnpm + Turborepo monorepo)

```
finlytics/
├── CLAUDE.md                      # master prompt
├── .claude/                       # rules, agents, commands, skills, settings (see .claude/README.md)
├── package.json  pnpm-workspace.yaml (workspaces + version catalog)  turbo.json  tsconfig.base.json  .nvmrc  .editorconfig
├── eslint.config.mjs              # the only ESLint config: presets from packages/config/eslint-config, scoped by globs
├── commitlint.config.mjs  .husky/ # pre-commit: lint-staged; commit-msg: Conventional Commits
├── .prettierignore
├── scripts/audit.mjs  audit-exceptions.json   # `pnpm audit:ci`: CI audit gate with expiring, GHSA-keyed exceptions
├── .github/workflows/ci.yml       # static (format, lint, typecheck, check:pkg) → unit → integration → security; e2e, Trivy, images later
├── .github/dependabot.yml         # weekly npm (prisma and vitest groups) + github-actions updates
├── docker-compose.yml  .env.example
├── docs/                          # architecture decisions, plans/
├── infra/
│   ├── docker/{web,api,ai-engine}.Dockerfile
│   ├── k8s/{base,overlays/{staging,prod}}/   # kustomize
│   ├── nginx/  grafana/  timescale/init.sql
│
├── apps/
│   ├── web/                                   # Next.js 15
│   │   ├── next.config.ts  tailwind.config.ts  postcss.config.mjs  middleware.ts (auth, locale)
│   │   ├── public/charting_library/           # TradingView Advanced Charts (vendored, gitignored, license)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx  globals.css  not-found.tsx
│   │       │   ├── (marketing)/page.tsx pricing/
│   │       │   ├── (auth)/login/ signup/ verify/ 2fa/
│   │       │   └── (app)/                      # authenticated shell: sidebar + topbar
│   │       │       ├── layout.tsx  loading.tsx  error.tsx
│   │       │       ├── dashboard/   charts/[instrument]/   option-chain/   markets/
│   │       │       ├── watchlists/  strategies/ (list, [id]/edit, [id]/backtest, builder/)
│   │       │       ├── backtests/   agents/ (orchestrator view, [runId])
│   │       │       ├── orders/  positions/  pnl/ (calendar)   alerts/   brokers/   settings/(profile|security|brokers|trading|notifications|appearance|billing)
│   │       │       └── admin/
│   │       ├── features/                        # feature-sliced
│   │       │   ├── auth/  brokers/  dashboard/  charts/  option-chain/  market-data/  watchlists/
│   │       │   ├── strategies/ (builder/, code-editor/, deploy/)  backtests/  agents/  orders/  positions/  pnl/  alerts/  notifications/  settings/
│   │       │   └── <feature>/{components,hooks,api,store,schemas,index.ts}
│   │       ├── components/                      # app-level composites: AppShell, Sidebar, Topbar, CommandPalette, ThemeToggle
│   │       ├── lib/ (api-client.ts, realtime/{provider,client,useTick,useSubscribe}.ts, auth.ts, tv-datafeed/, utils.ts)
│   │       ├── stores/ (ui.store.ts, market.store.ts, order.store.ts)
│   │       └── styles/
│   │
│   ├── api/                                   # NestJS 11 (Fastify)
│   │   ├── nest-cli.json  tsconfig.json
│   │   ├── prisma → ../../packages/database
│   │   └── src/
│   │       ├── main.ts  app.module.ts  (bootstraps http | gateway | worker | feed based on APP_ROLE env)
│   │       ├── common/ (guards, decorators, filters, interceptors, pipes, idempotency, rate-limit, logger, problem-json)
│   │       ├── config/ (env.schema.ts, config.module.ts)
│   │       ├── infra/ (prisma.service, redis.service, queue.module, vault/, telemetry/)
│   │       └── modules/
│   │           ├── auth/        users/        plans/        audit/
│   │           ├── broker/      (accounts, oauth, vault, gateway, registry, token-refresh.processor)
│   │           ├── market-feed/ (feed.leader, upstox.feed, dhan.feed, tick.fanout, subscriptions)
│   │           ├── market-data/ (quotes, candles, instruments, search, tv-udf controller)
│   │           ├── option-chain/ (chain builder, greeks proxy, snapshots)
│   │           ├── watchlist/   alerts/       notifications/ (email, push, telegram)
│   │           ├── orders/      positions/    portfolio/ (funds, holdings, pnl, calendar)
│   │           ├── strategies/  (crud, validator, runner.processor, sandbox/)
│   │           ├── backtests/   (proxy to ai-engine, results)
│   │           ├── agents/      (orchestrator proxy, signals, auto-trade config, risk)
│   │           ├── risk/        (RiskService, kill switch, limits)
│   │           ├── settings/    admin/        health/
│   │           └── realtime/    (gateway.ts, rooms, auth handshake)
│   │
│   └── ai-engine/                             # Python 3.12 / FastAPI
│       ├── pyproject.toml  uv.lock  Dockerfile
│       ├── app/
│       │   ├── main.py  config.py  deps.py  auth.py  llm.py
│       │   ├── api/ (routes: health, greeks, indicators, analysis, backtest, agents)
│       │   ├── data/ (redis_reader.py, timescale_reader.py, instrument_repo.py)
│       │   ├── quant/ (greeks.py, indicators.py, smc.py, orderflow.py, support_resistance.py, volatility.py)
│       │   ├── backtest/ (engine.py, fills.py, charges.py, metrics.py, calendar.py)
│       │   ├── agents/
│       │   │   ├── graph.py (LangGraph StateGraph)  state.py  master.py
│       │   │   ├── news_agent.py  global_markets_agent.py  crypto_agent.py  commodities_agent.py
│       │   │   ├── option_chain_agent.py  technical_agent.py  orderflow_smc_agent.py  risk_agent.py  execution_agent.py
│       │   │   └── tools/ (market_tools.py, chain_tools.py, news_tools.py, execution_tools.py)
│       │   ├── collectors/ (rss.py, macro_calendar.py, crypto.py, commodities.py)  # scheduled
│       │   └── models/ (pydantic schemas)
│       └── tests/
│
└── packages/
    ├── database/   prisma/{schema.prisma, migrations/<timestamp>_<name>/, seed.ts, seed/, seed-data/*.json}
    │               src/{index.ts, client.ts, env.ts, generated/ (Prisma client, gitignored)}
    ├── shared/     src/{schemas/*.ts (zod), types/, constants/ (exchanges, segments), instrument-key.ts, money.ts}
    ├── ui/         src/{styles/tokens.css, components/ (shadcn + ours), mui-theme.ts, hooks/, icons.ts}  .storybook/
    ├── broker-sdk/ src/{adapter.ts, types.ts, registry.ts, rate-limiter.ts, circuit-breaker.ts, brokers/{upstox,dhan}/, __tests__/}  README.md
    ├── config/     eslint-config/ (base, library, node)  tsconfig/ (library.json, node.json)  prettier/
    └── telemetry/  otel setup shared by web + api
```

## Conventions
- Import aliases: `@finlytics/shared`, `@finlytics/ui`, `@finlytics/broker-sdk`, `@finlytics/database`; inside apps `@/`.
- File names kebab-case; React components PascalCase exports; one component per file.
- Feature folders own their state, hooks and API calls; pages only compose features.
- Migrations: `packages/database/prisma/migrations/<YYYYMMDDHHMMSS>_<snake_case_name>/migration.sql`, the 14-digit UTC
  timestamp Prisma generates. Create one with `pnpm db:migrate --create-only --name <name>`; never number folders by
  hand (`0001_…` sorts before every timestamp, so it would run first). Custom SQL (TimescaleDB, triggers, CHECK
  constraints) goes in its own migration, and every statement in it is idempotent.
- Seed data: `packages/database/prisma/seed-data/*.json` (for example `market-holidays-2026.json`), validated by Zod in
  `prisma/seed/` and loaded by `pnpm db:seed`. Each file records the official source it was taken from.
