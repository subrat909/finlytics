# 06 — Security Architecture & Threat Model

## Assets
Broker credentials/tokens (highest), order execution capability, user PII, strategy IP (user's code), P&L data.

## Threat model (STRIDE summary)
| Threat | Control |
|---|---|
| Stolen session → place orders | httpOnly Secure cookies, 2FA required for live trading toggle, re-auth (step-up) for broker connect & kill-switch off, session revocation list |
| IDOR on orders/strategies | repository scoping by `userId`, Prisma middleware guard, tests for cross-user access; in the database, every relation between user-owned tables is a composite FK on `(id, userId)`, so a row can never reference another user's row |
| Broker token exfiltration from DB | AES-256-GCM envelope encryption; master key outside DB (KMS); decrypt only in vault service; tokens never serialised |
| Token exfiltration via logs | pino redaction + log review tests; error filter strips headers |
| Malicious strategy code | `isolated-vm` / sandboxed Python worker, no net/fs, CPU/mem/time limits, output size cap |
| Order spam / runaway algo | per-user order rate cap (10/s), daily loss limit, max positions, kill switch, circuit breaker on broker errors |
| XSS | React escaping, CSP with nonces, no `dangerouslySetInnerHTML`, Trusted Types in prod |
| CSRF | SameSite=Lax + Auth.js CSRF token + custom header check on mutations |
| Injection | Zod + Prisma; raw SQL only tagged; Timescale queries parameterised |
| Supply chain | lockfile, Dependabot, `pnpm audit`, Trivy, SBOM, pinned Docker digests |
| Replay of order requests | Idempotency-Key (SETNX 24 h) returning original response |
| Insider/admin abuse | admin actions audited, 2FA + IP allowlist, least-privilege DB roles |
| DDoS | Cloudflare, per-IP rate limits, WS connection cap per user, backpressure (volatile emits) |

### Dependency audit exceptions
CI's `security` job runs `pnpm audit:ci` (`scripts/audit.mjs`). It fails on any high or critical advisory that has no
active exception in `scripts/audit-exceptions.json`, and on audit output it can't read (a registry error, for example).
- **Keyed by GHSA id.** Each entry names the package and the severity it was reviewed at. It covers only that advisory,
  and stops covering it if the severity is raised. pnpm's own `auditConfig` ignores have no expiry, so the script
  rejects them.
- **Reachability justification required.** `reason` shows why the vulnerable code can't be reached here: what pulls the
  package in (`pnpm why -r <pkg>`), which code path loads it, and why no attacker-controlled input gets there. "Dev
  dependency" alone is not a reason. `tracking` points at the upstream fix to watch.
- **Expires in at most 90 days.** The script fails on an expired entry and on one dated more than 90 days ahead, so an
  extension means re-checking the reason. An entry that no longer matches any advisory prints a warning: delete it.

| Advisory | Package | Why it is unreachable | Expires | Tracking |
|---|---|---|---|---|
| GHSA-ggr8-5vv4-36mx (high) | deepmerge-ts 7.1.5 | Used only by `@prisma/config` (prisma CLI) to merge our own static `prisma.config.ts` at CLI time; no untrusted or recursive input reaches it, and the app never loads it | 2026-12-31 | [prisma/orm#30295](https://github.com/prisma/orm/issues/30295) |
| GHSA-3f6p-5ww8-9rcr (high) | mysql2 3.15.3 | Used only by the prisma CLI, in Prisma Studio's MySQL executor. Our datasource is PostgreSQL and the runtime uses `@prisma/adapter-pg` + `pg`, so it never connects to MySQL | 2026-12-31 | [prisma/orm#30295](https://github.com/prisma/orm/issues/30295) |

## Crypto design (BrokerVaultService)
```
masterKey (KMS / env, 32 B) ──wrap──▶ dataKey (per BrokerAccount, 32 B random)
plaintext credentials JSON ──AES-256-GCM(dataKey, iv 12 B, aad = userId:accountId)──▶ ciphertext || tag
stored: { encKey (wrapped), iv, ct, tag, keyVersion }
```
Rotation: new master key version → background job rewraps data keys; no plaintext re-encryption needed.

## Auth flows
1. **App login**: Auth.js OAuth (Google/GitHub) or email magic link → DB session → optional TOTP.
2. **Broker connect (Upstox)**: `POST /broker-accounts` → redirect to Upstox authorize (state = signed nonce) → callback → exchange code server-side using **our** app key/secret (user never types keys) → encrypt token → `ACTIVE`. Daily re-login: at 08:30 IST notify; one click repeats step (session already logged into Upstox in browser → instant).
3. **Broker connect (Dhan)**: user pastes access token once (Dhan has no OAuth) → encrypted → renewal reminder.
4. **Service auth**: api → ai-engine RS256 JWT (5 min), ai-engine → api callback with same.

## Compliance notes (India)
- DPDP Act 2023: consent, data export/delete, breach notification process.
- SEBI algo framework: order tagging with algo ID, static IP for API orders, audit trail retention (5 years) — `AuditLog` partitioned by month, archived to object storage.
