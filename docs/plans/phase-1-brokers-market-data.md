# Phase 1.2–1.6 — Brokers & market data (contract plan)

Status: **built** — all six streams merged; root gates and e2e (4/4) green · 2026-10-06 · branch `feat/phase-1-brokers-market-data`

Six streams build in parallel. This file is the contract between them; anything not fixed here is the owning
stream's decision. Builder rules from earlier plans still apply (no `.env*` reads, no installs, no real broker calls
in tests, Conventional Commits by the orchestrator).

## Streams and ownership

| Stream | Owner | Paths |
|---|---|---|
| A — Upstox adapter (1.2) | broker-integrator | `packages/broker-sdk/src/brokers/upstox/**` (+ one registry/index line) |
| B — Dhan adapter (1.3) | broker-integrator | `packages/broker-sdk/src/brokers/dhan/**` (+ one registry/index line) |
| C1 — API brokers, vault, instruments, watchlists, jobs | backend-engineer | `apps/api/src/modules/{brokers,instruments,watchlists,quotes}`, `apps/api/src/infra/{vault,queue}`, `apps/api/src/jobs/**`, `packages/database/**`, `packages/shared/src/schemas/{brokers,instruments,watchlists,quotes}.ts` |
| C2 — API realtime, feed worker, candles, UDF | backend-engineer | `apps/api/src/modules/{realtime,candles,udf}`, `apps/api/src/feed/**`, `apps/api/src/main.ts` roles, `packages/shared/src/schemas/{realtime,candles}.ts` |
| E1 — UI shell + design changes + settings | frontend-engineer | `packages/ui/**`, `apps/web/src/components/shell/**`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(app)/settings/**`, rules/docs for UI |
| E2 — Web features | frontend-engineer | `apps/web/src/features/{brokers,watchlists,charts,realtime}/**`, `apps/web/src/app/(app)/{brokers,watchlists,charts}/**` |

Shared files (`app.module.ts`, `packages/shared/src/index.ts`, `env.schema.ts`, `ci.yml`, docs): **Edit only, never
Write**, small appends.

## Decisions

- P1. **Process roles** (C2 owns dispatch): `APP_ROLE` accepts a comma list of `http`, `gateway`, `feed`, `worker`.
  `pnpm dev` sets `APP_ROLE=http,gateway,feed,worker`. C1 registers job processors for `worker`.
- P2. **Shared market feed source**: `MARKET_FEED_SOURCE=paper|upstox` (default `paper` outside production).
  `paper` = a deterministic tick simulator so the app works with no broker. `upstox` uses the token of the
  `BrokerAccount` id in `MARKET_FEED_ACCOUNT_ID` (one platform account drives the one shared WS, broker.md).
- P3. **Vault** (C1, carry-forward 1): AES-256-GCM envelope. Per row a random 256-bit data key wrapped by the master
  key (`MASTER_KEY`, base64 32 bytes; KMS later). **Separate 96-bit IV per ciphertext** (credentials, client id),
  tag stored with each ciphertext, AAD = `userId:brokerAccountId:<field>`. Decrypt only in `VaultService`. Schema
  migration replaces the shared `encIv`. docs/06 and security.md updated to this AAD.
- P4. **Upstox connect**: each user registers their own Upstox app once. `POST /v1/brokers/upstox`
  `{label, apiKey, apiSecret}` → PENDING account + `{authUrl}`; state = signed nonce bound to the session, stored in
  Redis `oauth:state:<nonce>` (10 min, single use). `GET /v1/brokers/upstox/callback?code&state` → token exchange →
  ACTIVE, `tokenExpiresAt` = next 03:30 IST → 302 to `/brokers?connected=<id>`. Redirect URI = `${AUTH_URL}/v1/brokers/upstox/callback` (exact match).
- P5. **Dhan connect**: `POST /v1/brokers/dhan` `{label, clientId, accessToken}` → validate with `getProfile` →
  ACTIVE, `tokenExpiresAt` from the token (JWT `exp`) or +30 d.
- P6. **Instrument master** (C1): BullMQ `instrument-master-sync` daily 08:00 IST per broker (+ on demand
  `POST /v1/admin/instruments/sync`). Upserts `Instrument`, writes a reverse map table
  `InstrumentBrokerToken(broker, token) → instrumentKey` (carry-forward 6), never deletes (sets `isActive=false`).
  Dev without broker creds: a seed of ~200 common NSE instruments (indices, NIFTY 50 stocks, current NIFTY/BANKNIFTY
  options) so search/watchlists/charts work.
- P7. **Token expiry job** (C1): `broker-token-expiry` 08:30 IST marks expired Upstox tokens `NEEDS_RELOGIN`; Dhan
  reminder 3 days before expiry (in-app notification row).

## Redis keys (C2 writes market data; C1 reads quotes)

| Key | Type | Content |
|---|---|---|
| `ticks:<BROKER>` | stream (MAXLEN ~100k) | normalised ticks from the feed worker |
| `quote:<instrumentKey>` | hash | `ltp, close, chg, chgPct, vol, oi, bid, ask, ts` (decimal strings, ts ms) |
| `q:<instrumentKey>` | pub/sub | latest tick JSON |
| `subs:<instrumentKey>` | int | gateway ref-count; 0 → unsubscribe after 30 s grace |
| `subs:wanted:<BROKER>` | set | keys the feed must be subscribed to (feed reconciles) |
| `lock:feed:<BROKER>` | string | leader lock, `SET NX PX 15000`, renewed every 5 s |
| `oauth:state:<nonce>` | string | Upstox OAuth state (C1) |

## REST (prefix `/v1`, session auth, problem+json, Zod schemas in shared)

- Brokers (C1): `GET /brokers`, `POST /brokers/upstox`, `GET /brokers/upstox/callback` (`@Public`, state-checked),
  `POST /brokers/dhan`, `POST /brokers/:id/relogin` → `{authUrl}` (Upstox) or 422 for Dhan (paste a new token via
  `POST /brokers/dhan` with the same label), `PATCH /brokers/:id` `{label?, isDefault?}`, `DELETE /brokers/:id`.
  Response `BrokerAccountView`: `id, broker, label, status, isDefault, tokenExpiresAt, lastLoginAt, lastError` —
  never credentials or client id.
- Instruments (C1): `GET /instruments?q=&exchange=&segment=&limit=20` (trigram, prefix boost), `GET /instruments/:key`.
- Watchlists (C1): `GET /watchlists` (with items), `POST /watchlists {name}`, `PATCH /watchlists/:id {name?, position?}`,
  `DELETE /watchlists/:id`, `POST /watchlists/:id/items {instrumentKey}`, `DELETE /watchlists/:id/items/:itemId`,
  `PUT /watchlists/:id/items/order {itemIds}`. Plan limits enforced (`Plan.maxWatchlists`, `maxWatchlistItems`).
- Quotes (C1): `GET /quotes?keys=a,b` (≤ 50) → `{[key]: Quote}` from `quote:*`.
- Candles (C2): `GET /candles?key=&tf=M1|M5|M15|H1|D1&from=&to=` (ISO or epoch s) → `Candle[]`
  (`ts, open, high, low, close, volume, oi?`). Serves Timescale; on a gap, backfills via `BrokerGateway.getHistoricalCandles`
  with the user's default ACTIVE account (or the paper source), stores, never re-fetches stored ranges.
- UDF (C2, TradingView datafeed): `GET /udf/config`, `/udf/time`, `/udf/symbols?symbol=`, `/udf/search?query=&limit=`,
  `/udf/history?symbol=&resolution=&from=&to=` (UDF JSON shape: `s, t, o, h, l, c, v`).

## WebSocket (C2 server, E2 client)

- Socket.IO, namespace `/rt`, path `/rt/socket.io`, parser `socket.io-msgpack-parser` on both ends,
  `@socket.io/redis-adapter` for multi-pod. Engine: socket.io's default `ws` (uWS isn't on npm; noted deviation).
- Dev: the browser connects to `NEXT_PUBLIC_RT_URL` (default `http://localhost:4000`); the session cookie is sent
  because cookies ignore ports. Production: same origin `/rt` via the ingress. Handshake validates the session cookie
  (SessionService) and Origin (API_ALLOWED_ORIGINS).
- Client → server: `sub` `{keys: InstrumentKey[]}` ack `{ok: InstrumentKey[], rejected: {key, reason}[]}`;
  `unsub` `{keys}`. Max per socket = the user's `Plan.maxRtSubscriptions` (default 100).
- Server → client: `q` `{t: epochMs, d: [key, ltp, chg, chgPct, vol, ts][]}`, coalesced every 100 ms, at most
  10 updates/s per instrument; `status` `{feed: "up"|"down"|"stale"}`. Room `user:<id>` reserved for 2.1.

## Web (E2 features, E1 shell)

- `RealtimeProvider` (one socket per tab), `useSubscribe(keys)` ref-counted, `useTick(key)` selector on a zustand
  Map, rAF batching ≤ 10 fps, stale (> 5 s) → grey dot, ▲/▼ glyph + colour.
- `/brokers`: account cards (status badge, expiry, relogin, remove, default), add wizard (Upstox: API key/secret →
  redirect; Dhan: client id + token), NEEDS_RELOGIN banner component (E1 renders it in the shell slot).
- `/watchlists`: tabs, instrument search combobox, virtualised rows (TanStack Virtual), live PriceCell, reorder, remove.
- `/charts?key=`: Lightweight Charts v5 from `/v1/candles` + live last bar from ticks; timeframe switcher; if
  `/charting_library/charting_library.js` exists, Advanced Charts via `next/dynamic` with the UDF datafeed.
- E1: navbar `bg-surface-1` (same as sidebar) with bottom border, sidebar right border, sidebar toggle button in the
  navbar, centred search (opens the ⌘K/instrument search), full-width content (no max-width container), borders on
  cards, inputs and other surfaces — **never on buttons**; theme options move to `/settings` (Appearance), persisted
  with `PATCH /v1/me/settings`; sidebar nav gets Dashboard, Watchlists, Charts, Brokers, Settings.

## Done when

Root `pnpm lint typecheck test check:pkg test:integration test:storybook test:visual audit:ci` green; the web e2e
covers: connect paper flow → watchlist add → live price updates → chart renders → settings theme switch.
