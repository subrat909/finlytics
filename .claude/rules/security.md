---
description: Security rules — applies to every file. Read before touching auth, broker, orders, or any API.
globs: ["apps/**", "packages/**"]
---

# Security Rules (OWASP ASVS L2 baseline)

## Authentication
- Auth.js v5 with database sessions (Prisma adapter). Cookies: `httpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix in prod.
- Passwords (email/password fallback only): argon2id, min 12 chars, breached-password check (HIBP k-anonymity).
- TOTP 2FA (otplib) with backup codes; required to enable live auto-trading.
- Session rotation on login/privilege change; absolute session lifetime 30 days, idle 7 days.
- Lockout: 5 failed logins → 15 min lock; all auth events written to `AuditLog`.
- Service-to-service (api ↔ ai-engine): short-lived JWT (RS256, 5 min) + mTLS inside cluster.

## Authorization
- Every repository method takes `userId` and scopes the query. Never trust an ID from the client to identify ownership; always `where: { id, userId }`.
- RBAC: `USER`, `ADMIN` (plan tiers live in `Plan`, not in roles). Guards: `@Roles()`, `@RequiresBrokerConnection()`, `@RequiresTradingEnabled()`.
- Admin endpoints under `/admin/*` require ADMIN + 2FA + IP allowlist.

## Broker credentials & tokens
- Stored in `BrokerAccount.encryptedCredentials` (AES-256-GCM, 96-bit IV, AAD = userId). Data key per row, wrapped by master key (`MASTER_KEY_ID` via KMS or `MASTER_KEY` env in dev).
- Decrypted only inside `BrokerVaultService` in `apps/api`; never returned by any API; never logged (redact with pino `redact` paths).
- Access tokens refreshed server-side by a BullMQ job before expiry; refresh failure → mark account `NEEDS_RELOGIN` and notify user.
- Broker OAuth redirect URIs are exact-match, state parameter is a signed nonce bound to the session.

## Input validation & injection
- Zod schemas from `packages/shared` validate every request body, query, param, WS message and job payload.
- Prisma only. `$queryRaw`/`$executeRaw` only with tagged templates (never `Unsafe` variants).
- Strategy code (user-written) executes in an isolated sandbox: `isolated-vm` for TS, `pyodide`/gVisor container for Python, with CPU/memory/time limits and **no network or filesystem**.
- Reject HTML in user strings; render with React (auto-escaped); CSP `default-src 'self'` with nonces for TradingView bundle.

## API hardening
- Rate limits (Redis token bucket): 100 req/min/IP public, 600 req/min/user authed, 10 orders/sec/user hard cap.
- Idempotency-Key header mandatory on POST /orders, /strategies/:id/deploy, /auto-trade.
- Helmet, HSTS, CORS allowlist from env, body limit 1 MB, request timeout 15 s.
- Errors: never leak stack traces or SQL; use RFC 7807 problem+json with correlation id.

## Data protection
- PII minimisation: store only email, name, avatar URL. Broker client ID is PII → encrypted.
- Logs: pino with redaction of `authorization`, `cookie`, `*token*`, `*secret*`, `*password*`, `credentials`.
- Backups encrypted; TimescaleDB retention policy on ticks (30 d raw, 1-min candles forever).
- Export/delete-my-data endpoints (DPDP Act compliance).

## Infrastructure
- Containers run non-root, read-only FS, dropped capabilities. Secrets via K8s secrets/External Secrets Operator.
- Cloudflare WAF + bot protection in front; only ingress exposed; DB/Redis on private network.
- Dependabot + `pnpm audit` + Trivy image scan in CI; fail on high severity.

## Checklist for every PR touching auth/broker/orders (run `/security-audit`)
- [ ] Ownership scoping on every query
- [ ] Zod validation on every input
- [ ] No secrets in logs/responses
- [ ] Idempotency + audit log on mutations
- [ ] Rate limit applied
- [ ] Tests for the unhappy path (wrong user, expired token, replay)
