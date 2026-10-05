# 06 — Security Architecture & Threat Model

## Assets
Broker credentials/tokens (highest), order execution capability, user PII, strategy IP (user's code), P&L data.

## Threat model (STRIDE summary)
| Threat | Control |
|---|---|
| Stolen session → place orders | httpOnly Secure cookies, 2FA required for live trading toggle, re-auth (step-up) for broker connect & kill-switch off, session revocation list |
| IDOR on orders/strategies | repository scoping by `userId`, Prisma middleware guard, tests for cross-user access |
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
