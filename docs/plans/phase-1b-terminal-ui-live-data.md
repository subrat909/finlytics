# Phase 1b — Terminal UI and live broker data (contract plan)

Status: **built** — 7 streams merged; root gates, visual (193) and e2e (4/4) green · 2026-10-07 · branch `feat/phase-1b-terminal-ui-live-data`

The user asked for: a professional, industry-standard UI (fixed navbar, sidebar and an info footer; an algo
dashboard; a broker-style watchlist; a TradingView-like chart page; a professional brokers page), real broker data
instead of simulated prices, sidebar tooltips only on hover, and a working Dhan connect.

## Root causes found (fix these first)

- **Simulated prices everywhere**: `MARKET_FEED_SOURCE` defaults to `paper`, and no instrument master was ever synced
  (`InstrumentBrokerToken` is empty), so even an ACTIVE Upstox account can't drive the feed. Paper candles were also
  stored in `Candle`, and paper quotes sit in `quote:*`.
- **Dashboard ignores the broker**: it renders a static "connect a broker" state; there are no portfolio endpoints.
- **Dhan can't be added**: the free plan allows 1 broker account (`seed/plans.ts`), the user already has Upstox → 403.
  The UI never shows the limit.
- **Tooltips without hover**: `ShellTooltip` stores Radix's `open` while disabled (expanded sidebar), so collapsing
  shows every tooltip that was hovered while expanded (`apps/web/src/components/shell/tooltip.tsx`).

## Streams and ownership (Edit-only on shared files; never `pnpm add`; no `.env*`)

| Stream | Agent | Owns |
|---|---|---|
| L — live data | backend-engineer | `apps/api/src/feed/**`, `apps/api/src/modules/{realtime,quotes,candles,udf,instruments,market}/**`, `apps/api/src/jobs/instrument-master-sync*`, `packages/shared/src/schemas/{realtime,quotes,market,candles,instruments}.ts` |
| P — portfolio and brokers api | backend-engineer | `apps/api/src/modules/{portfolio,brokers}/**`, `apps/api/src/jobs/broker-token-*`, `packages/shared/src/schemas/{portfolio,brokers}.ts`, `packages/database/prisma/seed/plans.ts`, `.claude/rules/broker.md` |
| B — broker adapters | broker-integrator | `packages/broker-sdk/**` |
| S — shell and design system | frontend-engineer | `packages/ui/**`, `apps/web/src/components/**`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/(app)/{layout.tsx,loading.tsx,error.tsx,not-found.tsx,[section]/**,settings/**}`, `apps/web/src/features/{market,settings,me}/**`, `apps/web/src/stores/**` |
| D — dashboard and brokers page | frontend-engineer | `apps/web/src/app/(app)/{dashboard,brokers}/**`, `apps/web/src/features/{dashboard,brokers,portfolio}/**` |
| W — watchlists and realtime client | frontend-engineer | `apps/web/src/app/(app)/watchlists/**`, `apps/web/src/features/{watchlists,realtime,instruments}/**` |
| C — charts | frontend-engineer | `apps/web/src/app/(app)/charts/**`, `apps/web/src/features/charts/**` |

Shared files (`app.module.ts`, `role-modules.ts`, `jobs/worker.module.ts`, `jobs/job-scheduler.service.ts`,
`infra/queue/queue-names.ts`, `infra/redis/keys.ts`, `config/env.schema.ts`, `packages/shared/src/index.ts`,
`apps/api/test/integration/app.ts`, docs): small Edits only. `apps/web/e2e/**` belongs to the orchestrator: report
changed flows and selectors instead of editing it. Already installed: `@nestjs/event-emitter` (api),
`@tanstack/react-table` (web). Already written (extend, don't replace): `packages/shared/src/schemas/{market,portfolio}.ts`,
the realtime/quotes/brokers additions, `apps/web/src/components/page.tsx`, `apps/web/src/features/market/hooks/use-market-overview.ts`.

## Backend contract

### Feed source (L)
- `MARKET_FEED_SOURCE=auto|paper|upstox|dhan`; default `auto` outside production; production requires an explicit
  broker source + `MARKET_FEED_ACCOUNT_ID` (`auto` and `paper` rejected there by env validation).
- `auto` picks, re-evaluated every 30 s and on the `broker.account.*` events: `MARKET_FEED_ACCOUNT_ID` if ACTIVE →
  the ACTIVE UPSTOX account with the latest `lastLoginAt` → the latest ACTIVE DHAN account → PAPER. A broker feed that
  fails to authorise (NEEDS_RELOGIN) or has no mapped instruments falls back to PAPER with a `reason`, and retries.
- The wanted set becomes broker-agnostic: `subs:wanted` (instrumentKeys). The feed maps keys to the current broker's
  tokens through `InstrumentBrokerToken`; keys without a token are skipped (no quote, the UI shows "—").
- Pinned keys always subscribed: every `MARKET_INDEX_KEYS` value plus the NIFTY 50 constituents (`NIFTY_50_KEYS`,
  a new export in `schemas/market.ts`, equal to the dev seed's 50 EQ instruments).
- `feed:source` hash `{broker, live, accountId, since, reason}`; `status` event = `{feed, source, live}`.
- Going live (PAPER → broker): delete `quote:*` written by the simulator, and never serve synthetic candles: purge
  paper-written `Candle` rows and `candles:cov:*` once (marker `candles:origin`), and from then on paper candles are
  only generated on the fly, never stored, while a broker source is live.
- Upstox subscribes in `full` mode (OHLC, ATP, 5-level depth) up to the broker's per-connection limit, `ltpc` beyond.

### Quotes, depth and realtime (L)
- `quote:<key>` hash adds `open, high, low, atp, bidQty, askQty, ltq`; depth in `depth:<key>` (JSON
  `{t,bids,asks,tbq,tsq}`, TTL 1 day). `GET /v1/quotes` returns the new optional fields;
  `GET /v1/quotes/depth?key=` → `RtDepth` snapshot (404 without one).
- `q` rows are the 12-tuple in `RtQuoteRowSchema`; `dsub`/`dunsub`/`depth` per `schemas/realtime.ts`
  (≤ 3 depth keys per socket, ≤ 4 depth messages/s/key, depth key must be in the socket's `sub` set).

### Market overview (L)
- `GET /v1/market/overview` → `MarketOverviewSchema`, built from `quote:*`, `feed:source` and `MarketHoliday`,
  cached ≤ 1 s. Session phases per `MARKET_PHASES` docs (IST); `opensAt` is the next trading session's start.

### Instrument master (L)
- `broker.account.activated` → enqueue `instrument-master-sync` for that broker unless one succeeded in the last 20 h
  (`instruments:synced:<BROKER>`). On worker start, sync every broker that has an ACTIVE account and no sync record.
  Canonical keys from the broker masters must equal the seed's keys (indices: B supplies the alias table).

### Portfolio, brokers, plans, tokens (P)
- `GET /v1/portfolio/funds|positions|holdings?accountId=` per `schemas/portfolio.ts`: the user's default ACTIVE
  account when `accountId` is absent (ownership-checked, `where: {id, userId}`); none → 404 `NOT_FOUND`. Broker calls
  through `BrokerGateway`, cached 5 s per account in Redis (single-flight); auth failure → account `NEEDS_RELOGIN`
  (existing BrokerAccessService path) and 409 `NEEDS_RELOGIN`. Rows get symbol/name/exchange/segment/lotSize from
  `Instrument` and `ltp`/`close` from `quote:*` when the broker omits them.
- `GET /v1/brokers/limits` → `BrokerLimitsSchema`. Plans: free 2 broker accounts, pro 3, elite 5 (seed upserts must
  update existing rows; run `pnpm db:seed`).
- Domain events (`@nestjs/event-emitter`, register `EventEmitterModule.forRoot()` once in `app.module.ts`):
  `broker.account.activated` and `broker.account.deactivated` `{userId, accountId, broker}`, emitted after commit.
- Dhan tokens last 24 h: `broker-token-renew` job every 30 min renews ACTIVE Dhan tokens expiring within 3 h through
  `refreshToken` (RenewToken); failure → `NEEDS_RELOGIN` + `lastError`. Update `.claude/rules/broker.md` and the
  connect copy ("valid 24 hours, renewed automatically").

### Adapters (B)
- Re-verify against the official docs (WebFetch only; never call a live broker): Dhan profile, RenewToken, funds,
  positions, holdings, feed packets (quote: OHLC; full: OHLC + 5-level depth); Upstox v3 feed authorize, `full` mode
  OHLC/ATP/depth, per-connection subscription limits, v3 historical candles.
- Index aliases so both masters produce exactly the `MARKET_INDEX_KEYS` canonical keys (Upstox `NSE_INDEX|Nifty 50`,
  Dhan security ids 13/25/27/442/21/51/69…); NIFTY 50 EQ keys must be `NSE_EQ|<SYMBOL>` like the seed.
- Positions/holdings/funds mappers return canonical keys and decimal strings; fixtures for each.

## Web contract

### Design language (all web streams; `.claude/rules/frontend.md` still applies)
- Trading-terminal density: 13 px table text, `h-9` rows, mono tabular numbers right-aligned, ▲/▼ + profit/loss
  tokens, `text-xs uppercase tracking-wide text-fg-muted` column headers.
- Panels: `rounded-md border border-border bg-surface-1`; panel header `flex h-10 items-center justify-between
  border-b border-border px-3 text-sm font-medium`. Buttons never have borders; no shadows.
- Pages: `<main>` has no padding and is the scroll container. Standard pages: `PageContainer` + `PageHeader`
  (`@/components/page`). Watchlists and charts: `TerminalPage` (fills between navbar and footer).
- Simulated data must always be labelled: when `feed.live` is false, show an amber "Simulated" badge where prices
  appear (footer always; dashboard market panel; watchlist and chart headers).
- Every page: shaped skeleton, empty state with CTA, error state with retry, ≥ 360 px responsive, keyboard + ARIA.

### Shell (S)
- Sidebar fixed full height (`w-64 ↔ w-16`), grouped: Overview (Dashboard) · Markets (Watchlists, Charts, Option
  Chain·Soon, Markets·Soon) · Trading (Orders·Soon, Positions·Soon, P&L·Soon) · Algo (Strategies·Soon,
  Backtests·Soon, AI Agents·Soon, Alerts·Soon) · Account (Brokers, Settings). "Soon" items link to the existing
  coming-soon pages. Active item: primary indicator bar. Tooltips only on hover/keyboard focus while collapsed (fix
  the stale-open bug; test it).
- Navbar (h-14, `bg-surface-1`, bottom border, never scrolls): sidebar toggle · centred search (⌘K) · index ticker
  (`TICKER_INDEX_IDS` with live LTP/chg via `useSubscribe` + `useTick`, hidden < xl) · user menu.
- Footer status bar (h-8, `bg-surface-1`, top border, never scrolls), from `useMarketOverview()` and
  `useConnectionStatus()`/`useFeedStatus()`: NSE/BSE/MCX session dots with next open/close, feed source
  ("Live · Upstox" or amber "Simulated"), realtime connection state, IST clock (isolated 1 s timer), app version, a
  short SEBI risk line. Collapses to the essentials < 640 px.
- `packages/ui`: add Badge, Tabs, Tooltip (move ShellTooltip in), DropdownMenu, Popover, Separator, Kbd and a
  Table primitive (stories, a11y tests, exports); tune tokens for a terminal look; regenerate visual baselines.

### Dashboard and brokers (D)
- Dashboard (`PageContainer`): KPI row (Day P&L live, Funds available, Margin used, Open positions, Holdings
  value/day change); market panel (indices, breadth, gainers/losers/most active, simulated badge); positions table
  (live LTP/P&L from ticks, `@tanstack/react-table`); holdings summary; broker health (accounts, status, session
  countdown, feed source); risk and automation panel (paper/live mode, kill switch state if exposed, strategies and
  agents "arrive in 4.x/5.x" with CTA); no broker → onboarding checklist instead of the portfolio panels.
- Portfolio hooks in `features/portfolio` (TanStack Query, 5 s stale, refetch on window focus).
- Brokers page: accounts table/cards (broker mark, label, status badge, session expiry countdown and progress,
  last login, default, data-feed source marker, actions menu: re-login/renew, set default, rename, disconnect with
  confirm), plan usage from `/v1/brokers/limits` (disable connect at the limit with a clear message), connect wizard
  as a stepper with per-broker instructions (Upstox redirect URL copy; Dhan token "valid 24 hours, renewed
  automatically"), supported-broker catalog (Upstox, Dhan, Paper; others "coming soon").

### Watchlists and realtime (W)
- Realtime client: 12-tuple rows; `Tick` gains `open, high, low, close, oi, atp` (number | null); new
  `useDepth(key)` (dsub/dunsub, ref-counted), `useFeedSource()` → `{source, live}`. Keep every existing export.
- Watchlist like Kite/Upstox: `TerminalPage` split — left list panel (numbered watchlist tabs, search to add with
  exchange/segment badges and keyboard nav, dense virtualised rows: symbol, exchange tag, LTP, chg, chg%, ▲/▼,
  flash on change, hover actions: depth, chart, delete; drag or keyboard reorder) and right detail panel for the
  selected instrument (quote header, OHLC/prev close/ATP/volume/OI, 5-level depth with bid/ask bars and totals,
  mini chart via `/v1/candles`, "Open chart" link). < 1024 px: list only, detail as a sheet.
- Move the instrument search into `features/instruments` and keep re-exports at the old paths.

### Charts (C)
- TradingView-style workspace in `TerminalPage`, on Lightweight Charts v5 (Advanced Charts only if
  `/charting_library` exists): top toolbar (symbol search dialog, intervals 1m 3m 5m 15m 30m 1H 4H 1D 1W — 3m/30m/4H/1W
  resampled client-side, chart types candles/hollow/bars/line/area/baseline/Heikin Ashi, Indicators dialog,
  undo/redo for drawings, screenshot, fullscreen), left drawing toolbar (cursor, crosshair, trend line, ray,
  horizontal line/ray, vertical line, rectangle, Fibonacci retracement, price range/measure, text note, remove
  all, lock, hide), legend (symbol, exchange, interval, OHLC + change at the crosshair, live dot, per-indicator
  values with hide/settings/remove), bottom bar (ranges 1D 5D 1M 3M 6M YTD 1Y All, IST clock, % / log / auto scale),
  right panel (quote details and the user's watchlist, collapsible).
- Indicators as pure, unit-tested TS functions: SMA, EMA, WMA, VWAP, Bollinger Bands, SuperTrend, Donchian,
  Parabolic SAR (overlays); Volume, RSI, MACD, Stochastic, ATR, ADX, OBV (panes, v5 `paneIndex`). Inputs editable.
- Drawings are series primitives, persisted per symbol in localStorage (try/catch); layout (interval, type,
  indicators) persisted too. Live last bar from ticks; theme-aware colours from tokens.

## Done when
Root `pnpm format:check lint typecheck test check:pkg build test:integration test:storybook test:visual audit:ci`
green; e2e updated by the orchestrator; with the user's Upstox account ACTIVE the footer reads "Live · Upstox",
the dashboard shows Upstox funds/positions/holdings, and a Dhan account can be added next to it.
