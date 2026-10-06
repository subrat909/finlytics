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
├── .github/workflows/ci.yml       # static (format, lint, typecheck, check:pkg) → unit → integration, ui → e2e → security; Trivy, images later
├── .github/dependabot.yml         # weekly npm (prisma and vitest groups) + github-actions updates
├── docker-compose.yml  .env.example
├── docs/                          # architecture decisions, plans/
├── infra/
│   ├── docker/{web,api,ai-engine}.Dockerfile
│   ├── k8s/{base,overlays/{staging,prod}}/   # kustomize
│   ├── nginx/  grafana/  timescale/init.sql
│
├── apps/
│   ├── web/                                   # Next.js 16 (Turbopack), Auth.js v5; plan docs/plans/phase-0-web-bootstrap.md
│   │   ├── next.config.ts (loads the root .env, validates it, /v1 rewrite)  postcss.config.mjs  components.json (shadcn)
│   │   ├── vitest.config.mts (dom + node projects)  playwright.config.ts  turbo.json  e2e/ (Playwright: auth-shell.spec.ts)
│   │   ├── public/charting_library/           # TradingView Advanced Charts (vendored, gitignored, license)
│   │   └── src/
│   │       ├── proxy.ts                         # CSP nonce + session-cookie gate (never imports the database)
│   │       ├── auth.ts                          # Auth.js (lazy config): handlers, auth, signIn, signOut
│   │       ├── app/
│   │       │   ├── layout.tsx  globals.css  fonts.ts  not-found.tsx  global-error.tsx  page.tsx (→ /dashboard)
│   │       │   ├── api/auth/[...nextauth]/route.ts
│   │       │   ├── (marketing)/page.tsx pricing/                      # later
│   │       │   ├── (auth)/ layout.tsx  login/  verify/   (later: 2fa/)
│   │       │   └── (app)/                      # authenticated shell: sidebar + topbar
│   │       │       ├── layout.tsx  loading.tsx  error.tsx  not-found.tsx
│   │       │       ├── dashboard/   [section]/ (coming-soon states until each section ships)
│   │       │       ├── charts/[instrument]/   option-chain/   markets/   watchlists/  strategies/  backtests/  agents/
│   │       │       ├── orders/  positions/  pnl/ (calendar)   alerts/   brokers/   settings/(profile|security|…)
│   │       │       └── admin/
│   │       ├── features/                        # feature-sliced: <feature>/{components,hooks,api,store,schemas}
│   │       │   ├── auth/ (actions, schemas, errors, components)  dashboard/  me/  settings/   later: brokers/ charts/ …
│   │       ├── components/  providers.tsx  style-nonce.tsx  brand/ (logo, provider marks)
│   │       │   └── shell/ (app-shell, sidebar, sidebar-nav, mobile-nav, topbar, user-menu, command-palette, tooltip,
│   │       │              theme-control, shell-announcer, nav-items, use-shell-shortcuts)   # promote primitives to ui
│   │       ├── lib/ env.ts  csp.ts  auth/ (adapter, config, email, session, session-payload, callback-url)
│   │       │        api/client.ts   later: realtime/{provider,client,useTick,useSubscribe}.ts, tv-datafeed/
│   │       ├── stores/ (ui.store.ts, announcer.store.ts; later market.store.ts, order.store.ts)
│   │       ├── hooks/  test/ (setup, axe, render helpers)
│   │
│   ├── api/                                   # NestJS 11 on Fastify 5, CommonJS, built by plain tsc (no Nest CLI)
│   │   ├── package.json  tsconfig.json  tsconfig.build.json  turbo.json  vitest.config.mts  vitest.integration.config.mts  README.md
│   │   ├── scripts/dev-session.mts            # development only: a user + session in the local DB; prints the cookie
│   │   ├── test/ setup/  unit/  integration/ (Testcontainers TimescaleDB + Redis, *.int.test.ts)  support/ (test-only /v1/__test__ routes, never in dist)
│   │   └── src/
│   │       ├── main.ts  app.module.ts  (validate the env, then start the APP_ROLE: http; 1.4 adds gateway and feed, later worker)
│   │       ├── bootstrap/ (fastify-options, http-app, http-hardening, request-id, client-ip, reply-serializer, openapi)
│   │       ├── common/ decorators/ (public, current-user, request-meta, rate-limit, skip-rate-limit, idempotent)
│   │       │           guards/ (csrf)  filters/ (problem-details)  problem-json/  pipes/ (zod-validation)  logger/
│   │       │           rate-limit/ (GCRA model + Lua, service, guard, headers)  idempotency/ (fingerprint, Lua, store, interceptor)
│   │       ├── config/ (env.schema.ts, env.ts, config.module.ts)
│   │       ├── infra/ prisma/ (PrismaService: db + unscoped, tenancy extension, role check)  redis/ (RedisService, keys.ts)
│   │       │          lifecycle/ (readiness, ordered shutdown)   later: queue.module, vault/, telemetry/
│   │       └── modules/
│   │           ├── auth/        users/        settings/     audit/        health/        # 0.5
│   │           ├── plans/       admin/
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
    │               src/testing/ (the ./testing entry: startTestDatabase, TIMESCALE_IMAGE; a migrated Testcontainers database for the api's tests)
    ├── shared/     src/{schemas/*.ts (zod), types/, constants/ (exchanges, segments), instrument-key.ts, money.ts}
    ├── ui/         components.json  vite.config.ts  vitest.config.ts  playwright.visual.config.ts  turbo.json  README.md
    │               src/styles/ (tokens.css: colours, the only place · theme.css: Tailwind theme + shadcn bridge · base.css · globals.css: the import)
    │               src/components/<name>.tsx + <name>.stories.tsx + __tests__/<name>.test.tsx   # one exports entry each, no barrel
    │               src/{foundations/ (token stories), hooks/, lib/ (utils.ts: cn · theme.ts: theme names, no directive), test/ (jsdom setup, axe, story helpers)}
    │               .storybook/ (main.ts, preview.tsx, preview.css: globals + the stories' sources, design-checks.ts)   scripts/visual.mjs
    │               test/{tokens/ (contrast matrix, theme, Tailwind sources), package/ (exports, boundaries, deps, versions), ssr/, visual/ (stories.spec.ts, motion.spec.ts, __screenshots__/)}
    │               later: src/icons/brand/ (0.6), src/mui-theme.ts behind @finlytics/ui/data-grid (2.3)
    ├── broker-sdk/ src/{adapter.ts, types.ts, registry.ts, rate-limiter.ts, circuit-breaker.ts, brokers/{upstox,dhan}/, __tests__/}  README.md
    ├── config/     eslint-config/ (base, library, node, nest, react, restrictions)  tsconfig/ (library.json, node.json, react-library.json)  prettier/
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
