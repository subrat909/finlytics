# @finlytics/api

The Finlytics HTTP api: NestJS 11 on Fastify 5, CommonJS, built with plain `tsc` (plan
`docs/plans/phase-0-api-bootstrap.md`).

## Run

```sh
docker compose up -d postgres redis   # dev stack
pnpm dev                              # turbo: builds shared/database, then tsc --watch + node --watch on :4000
curl -i http://127.0.0.1:4000/health/live
open http://127.0.0.1:4000/docs       # Swagger UI; the OpenAPI 3.1 document is /docs/json (never in production)
```

`pnpm dev` loads the repo-root `.env` (`node --env-file-if-exists`); nothing else does. It sets
`APP_ROLE=http,gateway,feed,worker` itself (REST and Socket.IO `/rt` on one port, the market feed, job workers),
and a variable set in the environment wins over `.env`, so an `APP_ROLE` that `.env` sets for another tool doesn't
matter. The process validates its environment before Nest starts and exits 1 with one `VARIABLE: reason` line per
problem, never a value. `NODE_ENV` must be set explicitly unless `API_HOST` is loopback. Every variable and its
production rule: `src/config/env.schema.ts` and docs/04 §7.

The market feed's source is `MARKET_FEED_SOURCE` (docs/04 §4, §7):

- `auto` (the default outside production): the account in `MARKET_FEED_ACCOUNT_ID` if ACTIVE, else your latest ACTIVE
  Upstox account, else your latest ACTIVE Dhan account, else the simulator. Re-chosen every 30 s and when an account
  connects; a refused token or a broker without a synced instrument master falls back to the simulator with a reason
  (the UI then says "Simulated").
- `paper`: the deterministic simulator only.
- `upstox`, `dhan`: the account in `MARKET_FEED_ACCOUNT_ID` (required); never falls back to simulated prices.
  Production must use one of these two.

A broker feed needs that broker's instrument master: the worker syncs it at 08:00 IST, when an account is activated
(unless synced in the last 20 h), and on start for every broker with an ACTIVE account and no sync record.

To try authenticated routes before the web app's sign-in exists (0.6):

```sh
NODE_ENV=development node apps/api/scripts/dev-session.mts you@example.com   # local database only; prints a cookie
curl -i --cookie "authjs.session-token=<token>" http://127.0.0.1:4000/v1/me
curl -i -X PATCH -H 'content-type: application/json' --cookie "authjs.session-token=<token>" \
  -d '{"appearance":{"theme":"dark"}}' http://127.0.0.1:4000/v1/me/settings
```

## Layout

| Path                | What                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`       | validates the environment, then starts the process roles (`APP_ROLE`: `http`, `gateway`, `feed`, `worker`; `src/role-modules.ts`) |
| `src/feed/`         | the shared market feed (`feed` role): leader lock, source selection (`MARKET_FEED_SOURCE`), subscription reconcile, Redis writes  |
| `src/app.module.ts` | `AppModule.forRoot(env)`: global guards (CSRF → session → rate limit → auth), Zod pipe, idempotency and serializer interceptors   |
| `src/bootstrap/`    | Fastify options, HTTP hardening and OpenAPI (`/docs`), shared by main.ts and the tests                                            |
| `src/config/`       | the environment schema and loader; app code reads `ConfigService<Env, true>`                                                      |
| `src/common/`       | problem+json errors, logging, the validation pipe, CSRF, rate limiting (GCRA in Redis), idempotency, decorators                   |
| `src/infra/`        | Prisma (tenancy-guarded `db`), Redis (`keys.ts` builds every key), readiness and shutdown                                         |
| `src/modules/`      | `health`, `auth` (Auth.js sessions), `users` (`GET /v1/me`), `settings` (`GET`/`PATCH /v1/me/settings`), `audit`                  |
| `test/integration/` | Testcontainers TimescaleDB + Redis, apps built by the production bootstrap                                                        |
| `test/support/`     | test-only routes the harness adds (never compiled into `dist`)                                                                    |

New module: copy an existing one (`controller → service → repository`, DTOs from `@finlytics/shared`; see
`.claude/skills/nest-module/SKILL.md`). Guards are global; opt out with `@Public()`. Query through `this.prisma.db`.
Trading mutations: `@Idempotent()` (Idempotency-Key, replayed per user) and, for orders, `@RateLimit("orders")`.
Audit mutations with `AuditService.record(tx, …)` inside their transaction.

## Checks

```sh
pnpm --filter @finlytics/api typecheck
pnpm --filter @finlytics/api lint
pnpm --filter @finlytics/api test                                # unit tests, coverage gate 80%
pnpm exec turbo run test:integration --filter=@finlytics/api     # Docker; builds dist first
```
