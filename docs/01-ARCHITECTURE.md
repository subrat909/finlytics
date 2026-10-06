# 01 — System Architecture

## Goals
Multi-tenant SaaS, thousands of concurrent users, sub-100 ms tick-to-screen inside our boundary, **≤ 12 broker REST
endpoints and 2 broker WebSockets per broker regardless of user count**, strong isolation of broker credentials,
horizontal scalability, low memory per user.

## High-level diagram

```
                         ┌──────────────── Cloudflare (WAF, TLS, CDN) ───────────────┐
                         │                                                           │
   Browser ──HTTPS──▶ Next.js (apps/web) ──server actions/REST──▶ NestJS API (apps/api) ◀──▶ PostgreSQL+Timescale
      │                     │  (RSC, SSR shell, static assets)        │   ▲                  (users, orders, strategies,
      │                     └── Auth.js (sessions in Postgres)        │   │                   candles, chain snapshots)
      │                                                               │   │
      └────────── 1 Socket.IO WS per tab ──────────────▶ Realtime Gateway (apps/api, horizontally scaled, Redis adapter)
                                                                      │   │
                                                                      ▼   │
                                              Redis 7 (quotes hash, pub/sub, streams, BullMQ, rate limits, sessions cache)
                                                                      ▲   │
                    ┌─────────────────────────────────────────────────┘   │
                    │                                                     │
        Market Feed Workers (1 process per broker)             AI Engine (apps/ai-engine, FastAPI, Python)
        ├─ Upstox market WS  (ONE shared connection)           ├─ LangGraph orchestrator (master + agents)
        ├─ Upstox order WS   (ONE shared connection)           ├─ Greeks / indicators / SMC / orderflow (NumPy, Polars)
        ├─ Dhan market WS    (ONE shared connection)           ├─ Backtest engine (reads Timescale snapshots)
        └─ Dhan order WS     (ONE shared connection)           └─ News/macro collectors (RSS, APIs) → sentiment
                    │
                    ▼
        Broker REST (12 ops only, via BrokerGateway: rate-limiter + circuit-breaker + vault)
```

## Component responsibilities

| Component | Responsibility | Scale strategy |
|---|---|---|
| **apps/web** | UI, SSR shell, Auth.js, server actions calling API | Stateless, N replicas behind CDN |
| **apps/api (http)** | REST/OpenAPI, auth guards, business logic, Prisma | Stateless, N replicas |
| **apps/api (gateway)** | Socket.IO namespace `/rt`; rooms per instrumentKey and per user; Redis adapter for cross-node broadcast | N replicas; sticky sessions not required with Redis adapter |
| **apps/api (workers)** | BullMQ processors: token refresh, instrument master, candle aggregation, strategy runner, alerts, notifications | Scale by queue |
| **market-feed worker** | Owns the single broker WS; ref-counted subscriptions; normalises ticks → Redis | **Exactly one leader per broker** (Redis lock/lease). Hot standby replica takes over on lease expiry |
| **apps/ai-engine** | Agents, numerics, backtests | CPU-bound; scale horizontally; backtests via queue |
| **PostgreSQL + Timescale** | System of record; hypertables for ticks/candles/chain snapshots with compression + retention | Primary + read replica; PgBouncer |
| **Redis** | Quote cache, pub/sub fan-out, streams, queues, rate limits | Redis Cluster / managed |

## One origin: how requests reach the api
- **Production:** the ingress (behind Cloudflare) serves a single origin. `/v1/*` goes to `api-http`, `/rt` to
  `api-gateway` (from 1.4), and everything else to Next.js. `/health/*` and `/docs*` are never routed; probes reach
  pods directly, and `/docs` doesn't exist in production.
- **Development:** Next.js rewrites `/v1/*` to `http://127.0.0.1:4000`, so the browser still talks to one origin.
- **Why:** the Auth.js session cookie is `__Host-authjs.session-token` in production. A `__Host-` cookie carries no
  `Domain`, so only the host that set it receives it; a separate `api.` host would never see the session. One origin
  also keeps the api's CORS allowlist down to the web origin and its CSRF check to an exact `Origin` match.
- Server actions in Next.js call the api server-side, forwarding only the incoming `Cookie` and `x-request-id`.

## Why one WebSocket per broker works for many users
Broker feeds are **per developer app**, not per end user, for market data. The market-feed worker subscribes the union
of all instruments any user is watching (ref-counted), receives each tick once, and fans it out via Redis to every
gateway node, which pushes it to each subscribed browser. Order updates, however, are per broker *account*: for
brokers whose order-update WS is account-scoped, the worker multiplexes one connection per connected account
inside the same process (still no REST polling) — budget stays "2 WS per broker *type*", plus one per account for
order updates where the broker mandates it. Fallback: reconcile via `getOrderBook` every 60 s only if the order WS is down.

## Tick-to-screen path (target < 100 ms inside our boundary)
1. Broker WS binary frame → decode (protobuf/struct) in worker (~0.2 ms).
2. `HSET quote:<key>` + `PUBLISH q:<key>` (pipelined, ~0.3 ms).
3. Gateway node receives pub/sub, batches per room for 50–100 ms, encodes msgpack, emits volatile (dropped if client lagging).
4. Browser: `RealtimeProvider` writes to Zustand Map; cells re-render via rAF-throttled selectors.

## Multi-tenancy & isolation
- Row-level ownership (`userId`) on all user data. In apps/api, repositories query through `PrismaService.db`, which
  carries the **tenancy guard**: a Prisma `$extends` query extension (Prisma 7 has no `$use` middleware,
  `src/infra/prisma/tenancy.extension.ts`). On a model with a `userId` column, every read, update, delete and aggregate
  must filter by `userId` (a top-level `userId`, or a compound unique key that contains it such as `id_userId`), and
  every create must set it on every row; `User` is scoped by `id`. `AuditLog` creates are exempt (append-only), but
  its reads need a `userId` or `actorId` filter. Child tables without `userId` (`WatchlistItem`, `AlertEvent`,
  `StrategyRunEvent`) are scoped through their parent's `userId`. Updates that would change `userId`, and `include`,
  `select` or relation filters that reach a user-owned model from an unscoped one, are refused. A violation
  throws `TenancyViolationError` (500: a bug, never a client error). The model list is kept equal to `schema.prisma`
  by a unit test. Raw SQL and nested writes aren't covered: code review and tests cover those.
- The base client, `PrismaService.unscoped`, is allowed only in `src/infra/prisma`, `src/modules/auth` (the session
  lookup by token hash) and `src/modules/health` (`SELECT 1`); an ESLint rule (`no-restricted-syntax` on `.unscoped`)
  enforces the allowlist.
- Per-user limits (strategies deployed, alerts, watchlists) by plan (`Plan` table) to protect shared resources.
- Strategy code runs in sandboxes with CPU/mem/time quotas; one strategy cannot block another.

## Redis key namespaces
Every key is built in `apps/api/src/infra/redis/keys.ts` and nowhere else, so namespaces can't collide across modules
and phases. Segments are separated by `:`; a segment never contains `:` or whitespace (user ids are cuids, instrument
keys use `|`, `IdempotencyKeySchema` forbids `:`), except a client IP, always the last segment. No `KEYS` and no
unbounded `SCAN` on the request path.

| Key | Type | TTL | Owner (phase) |
|---|---|---|---|
| `rl:<policy>:ip:<ip>`, `rl:<policy>:u:<userId>` | string (GCRA TAT in ms) | ≤ the policy period | rate limiting (0.5) |
| `brl:<BROKER>:<accountId>:<class>` (`class`: orders, data, standard; `accountId` `app` before an account exists) | string (GCRA TAT in µs) | until the bucket is full again | broker rate limiter (1.1, `@finlytics/broker-sdk`) |
| `idem:<userId>:<key>` | string (JSON marker or record) | 30 s in flight, 24 h stored | idempotency (0.5) |
| `quote:<instrumentKey>` | hash | none (overwritten) | market feed (1.4) |
| `q:<instrumentKey>` | pub/sub channel | — | tick fan-out (1.4) |
| `ticks:<broker>` | stream (`MAXLEN ~`) | — | feed (1.4) |
| `subs:<instrumentKey>` | counter | 30 s grace at zero | subscriptions (1.4) |
| `lease:feed:<broker>` | string | the lease | feed leader (1.4) |
| `bull:<queue>:*` | BullMQ | BullMQ | jobs (later) |

The api's request path uses one ioredis connection (`RedisService`: no offline queue, 1 s command timeout, reconnect
with capped backoff); BullMQ, the Socket.IO adapter and the feed get connections of their own.

## Resilience
- Market-feed leader election via Redis lease; standby replica reconnects within ~2 s and resubscribes from Redis `subs:*`.
- Circuit breaker per broker; when open, UI shows "Broker degraded" banner, orders blocked (fail-closed).
- Idempotent orders; reconciliation job on reconnect compares DB vs `getOrderBook`.
- Kill switch (global + per user) checked before every outgoing order.

## Observability
- OpenTelemetry traces across web → api → ai-engine; metrics: tick lag, WS clients, orders/sec, broker error rate,
  queue depth; alerts on feed silence > 5 s during market hours.

## Deployment topology (prod)
- K8s: `web` (2+), `api-http` (2+), `api-gateway` (2+), `api-workers` (1+ per queue group), `feed-upstox` (1 leader +
  1 standby), `feed-dhan` (same), `ai-engine` (2+), managed Postgres (Timescale), managed Redis.
- Static IP egress (NAT gateway) for broker API whitelisting (SEBI requirement).
