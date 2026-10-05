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
- Row-level ownership (`userId`) on all user data; Prisma middleware asserts `userId` present on user-owned models.
- Per-user limits (strategies deployed, alerts, watchlists) by plan (`Plan` table) to protect shared resources.
- Strategy code runs in sandboxes with CPU/mem/time quotas; one strategy cannot block another.

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
