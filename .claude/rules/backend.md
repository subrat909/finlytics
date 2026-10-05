---
description: Backend rules for apps/api (NestJS + Prisma) and packages/database.
globs: ["apps/api/**", "packages/database/**", "packages/shared/**"]
---

# Backend Rules (NestJS / Prisma)

## Module pattern
```
apps/api/src/modules/<name>/
  <name>.module.ts
  <name>.controller.ts      # HTTP only: parse → call service → map response. No business logic.
  <name>.service.ts         # business logic, transactions, events
  <name>.repository.ts      # Prisma queries, always scoped by userId
  <name>.gateway.ts         # (optional) Socket.IO namespace
  <name>.processor.ts       # (optional) BullMQ worker
  dto/                      # zod schemas re-exported from @finlytics/shared + nestjs-zod pipes
  __tests__/
```
- Use `nestjs-zod` `ZodValidationPipe` globally. Controllers return typed DTOs; never Prisma models directly (use mappers to strip internal fields).
- Use `@nestjs/event-emitter` for domain events (`order.filled`, `broker.disconnected`); gateways & notification module subscribe to events — modules never import each other's services for side effects.
- Config via `@nestjs/config` + Zod-validated `env.schema.ts`; app fails fast on missing env.

## Prisma
- Schema in `packages/database/prisma/schema.prisma`. Migrations committed; never `db push` in prod.
- Every user-owned table has `userId` + composite index `(userId, createdAt)`. Soft delete only where business needs history (strategies), otherwise hard delete.
- Money/prices as `Decimal(18,4)` in DB, `string` over the wire, `Decimal.js` in logic. Quantities as `Int`.
- Timescale hypertables (`Tick`, `Candle`, `OptionChainSnapshot`) are created by raw SQL migration after Prisma migration; Prisma reads them as normal tables.
- Use `select` to fetch only needed columns; paginate with cursor (`id` + `createdAt`), never offset for large tables.

## Realtime pipeline
```
Broker WS (1 per broker) → MarketFeedService (parse, normalise) → Redis Stream `ticks:<broker>`
  → TickFanoutWorker → Redis Pub/Sub `q:<instrumentKey>` + Redis Hash `quote:<instrumentKey>`
  → Socket.IO gateway rooms (room = instrumentKey) → clients (binary msgpack, coalesced 100 ms)
Broker order WS → OrderUpdateService → DB + event `order.updated` → gateway room `user:<id>`
```
- Subscriptions are ref-counted in Redis (`subs:<instrumentKey>` count). Unsubscribe from broker when count → 0 (with 30 s grace).
- Option chain Greeks computed in `ai-engine` from LTP + IV via Black-76 and cached 1 s; API serves from cache.

## Jobs (BullMQ)
- Queues: `broker-token-refresh`, `instrument-master-sync`, `candle-aggregate`, `strategy-runner`, `alerts-evaluator`, `notifications`, `backtest`.
- Jobs are idempotent and carry `userId`; retries with exponential backoff; dead-letter queue monitored.

## Orders
- `OrderService.place()` flow: validate → risk check (`RiskService`) → kill-switch check → idempotency check (Redis SETNX 24 h) → persist `Order(PENDING)` → broker adapter → update status → audit log → emit event.
- All broker calls go through `BrokerGateway` (adapter + rate limiter + circuit breaker). Timeouts 5 s; on timeout, reconcile via order book, never blindly retry a place.

## Error handling
- Throw typed domain errors (`InsufficientFundsError`, `BrokerRejectedError`) → global filter maps to problem+json with stable `code`.
- Correlation id (`x-request-id`) in every log line and response.

## Testing
- Unit test services with mocked repositories; integration test repositories with Testcontainers; contract tests for each broker adapter against recorded fixtures (`nock`).
