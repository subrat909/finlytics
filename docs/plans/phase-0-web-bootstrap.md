# Phase 0.6 — `apps/web` bootstrap (roadmap 0.6)

Status: **built — in review** (unit 121 tests, e2e 2 tests green locally) · 2026-10-06 · branch `feat/phase-0-ui-api` · pre-approved by the user (speed run)

Inputs: CLAUDE.md, `.claude/rules/{frontend,security}.md`, `.claude/skills/finlytics-ui`, docs/04 §7, docs/05, docs/06,
the carry-forward notes of `phase-0-api-bootstrap.md` §10.1 and `phase-0-ui-design-system.md` §11.1.

## Scope and demo
App Router app on **Next.js 16.3.8** with Auth.js v5 (Google, GitHub, email magic link), database sessions shared with
the api, the AppShell (sidebar, topbar, ⌘K), `/login`, an empty `/dashboard`. Demo: sign in, empty dashboard in light
and dark, the sidebar collapses smoothly.

## Decisions
| # | Decision | Why |
|---|---|---|
| W1 | **Next 16.3.8** (Turbopack, `proxy.ts`, ESLint CLI). CLAUDE.md §2 updated. | Next 15 support ends 2026-10-21 (ui plan D19). |
| W2 | **Env:** `next.config.ts` loads the repo-root `.env` with Node's `util.parseEnv` (never overrides a set variable, like the api's `--env-file-if-exists`), then validates `src/lib/env.ts` (Zod) in the `dev` and `start` phases: one `VARIABLE: reason` line per problem, never a value. Dev defaults for everything but `AUTH_SECRET`; production requires all and `https://`. | `@next/env` isn't a direct dependency, and its `loadEnvConfig` returns the cached first call (Next's own, for apps/web), so a second call for the root loads nothing. |
| W3 | **Auth.js adapter** (`src/lib/auth/adapter.ts`) wraps `@auth/prisma-adapter` on `getPrisma()`: SHA-256 hex of the session token in create/get/update/delete (the cookie keeps the raw token); emails trimmed and lowercased (create, lookup, update, and the email provider's `normalizeIdentifier`); `linkAccount` stores an allowlist (`userId`, `type`, `provider`, `providerAccountId`, `expires_at`, `token_type`, `scope`), so `access_token`, `refresh_token`, `id_token`, `session_state` never reach the database. | api plan §10.1 and foundations §10.3. An allowlist also drops provider-specific extras Prisma would reject. |
| W4 | **Session validity mirrors the api** in `getSessionAndUser`: the row must be < 30 days old (`createdAt`), seen in the last 7 days (`lastSeenAt`), and its user not deleted; otherwise the row is deleted and Auth.js clears the cookie. `maxAge` 7 d rolling, `updateAge` 1 d; each extension also writes `lastSeenAt`. Only `id`, `email`, `name`, `image` and the theme leave the adapter. Tokens: 32 random bytes, base64url (matches `SESSION_TOKEN_PATTERN`). | Auth.js and the api must agree on one session; the api only bumps `lastSeenAt` on `/v1` calls. |
| W5 | **Cookie:** `SESSION_COOKIE_NAME[NODE_ENV]`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`, `Secure` in production. | docs/06 session contract. |
| W6 | **Email:** our own `type: "email"` provider (id `email`) on nodemailer 10's `createTransport(EMAIL_SERVER)`, 10-minute links, plain-text + escaped HTML body. | Avoids the Nodemailer provider's v7/8 typings; one code path we test. |
| W7 | **Same origin (A1):** `beforeFiles` rewrite `/v1/:path*` → `API_INTERNAL_URL` (dev default `http://127.0.0.1:4000`), so no page can shadow it; production: the ingress. Client fetches are relative (`src/lib/api/client.ts`, problem+json aware): 401 → `/login`, 503 → retry, never sign out. | api plan §10.1. Next defines nothing under `/v1`. |
| W8 | **`src/proxy.ts`:** per-request CSP nonce (`script-src 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`, `style-src-attr 'unsafe-inline'`, `'unsafe-eval'` in dev only, `frame-ancestors 'none'`); cookie-presence gate → `/login?callbackUrl=`. Imports only `next/server`, `@finlytics/shared` and the env/CSP helpers; lint bans `@finlytics/database` and the auth modules there. Real validation: `auth()` in the `(app)` layout. Runtime `<style>` tags (Radix scroll lock via get-nonce) get the nonce from `__webpack_nonce__`, set by `StyleNonce`. | security.md CSP; foundations §10.3. The e2e found Radix's RadioGroup server-rendering `style` attributes; an attribute styles only its own element, so attributes are allowed while `<style>` elements stay nonce-only. |
| W9 | **Shell primitives are app-local for now** (`src/components/shell/*` on `radix-ui` + `cmdk`): tooltip, sheet, dropdown menu, avatar, command palette, Google/GitHub marks. Tokens only, no borders/shadows on controls, unit + axe tests here. **Follow-up:** promote them to `packages/ui` through its D8 checklist (stories + CI-made visual baselines). | packages/ui is outside this build's file boundary, and new stories need baselines made in CI. |
| W10 | **Sidebar:** `useUiStore.sidebarCollapsed` (Zustand `persist`, `finlytics-ui`), `w-64 ↔ w-16` `transition-[width] duration-200 ease-out`, content `transition-[margin]`, labels fade; `[` toggles (not in inputs); tooltips when collapsed; < 1024 px a Radix Dialog sheet. The page subtree is never conditionally rendered. | frontend.md "Sidebar". |
| W11 | **Theme:** root `ThemeProvider nonce`, `defaultTheme` from the account's settings (via the session); topbar `ThemeToggle` PATCHes `/v1/me/settings`. The device's stored choice wins. | ui plan D12. One-time cross-device sync: follow-up. |
| W12 | **Route loading announcements** come from a persistent shell live region (`useAnnouncer`); `loading.tsx` renders `PageLoader` + `<AnnounceLoading>`. | docs/05 Accessibility (0.6). |
| W13 | **Fonts:** `next/font/local` on the woff2 files of `@finlytics/ui`'s fontsource dependencies (resolved through `packages/ui/node_modules`). **Follow-up:** add both fontsource packages to apps/web (`catalog:`) and drop the cross-package path. | No installs in this build. |
| W14 | **Lint:** new `next` preset = `react` + `@next/next` core-web-vitals (all errors) + bans: `DETERMINISTIC_FORMATTING`, `REACT_PERF`, `NODE_PROTOCOL`, Prisma only via `@finlytics/database`, no deep `@finlytics/*/src`, `@radix-ui/*` → `radix-ui`, `process.env` only in `src/lib/env.ts`, configs, e2e; no `style` DOM prop. | ui plan §11.1 "Lint". React Compiler stays off (16 default). |
| W15 | **e2e on `next dev`** (Playwright `webServer`: built api + `next dev`, both reused if running). | Production mode needs `https` and the `__Host-` cookie. |

## Files
- `apps/web/`: `package.json` (scripts), `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.mts`,
  `playwright.config.ts`, `turbo.json`, `.gitignore` (`next-env.d.ts`), `components.json`.
- `src/proxy.ts`, `src/auth.ts`, `src/lib/{env,csp}.ts`, `src/lib/auth/{adapter,email,session-token,session,actions}.ts`,
  `src/lib/api/client.ts`, `src/stores/{ui,announcer}.store.ts`, `src/components/providers.tsx`,
  `src/components/shell/*`, `src/features/{auth,dashboard,me,settings}/**`.
- `src/app/`: `layout.tsx`, `globals.css`, `fonts.ts`, `page.tsx` (→ `/dashboard`), `not-found.tsx`, `global-error.tsx`,
  `api/auth/[...nextauth]/route.ts`, `(auth)/{layout,login/page,verify/page}.tsx`,
  `(app)/{layout,loading,error}.tsx`, `(app)/dashboard/{page,loading,error}.tsx`, `(app)/[section]/page.tsx` (coming-soon
  states for the other nav entries).
- Tests: `src/**/__tests__/*.test.{ts,tsx}` (jsdom + axe, node for auth helpers), `e2e/auth-shell.spec.ts`.
- Repo: `packages/config/eslint-config/next.js` (+ exports, tests), root `eslint.config.mjs`, `turbo.json`
  (`@finlytics/web#test:e2e`), `.github/workflows/ci.yml` (`e2e` job), CLAUDE.md §2 §5, docs/02, docs/05.

## Environment (apps/web)
| Variable | Example | Required |
|---|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` | always |
| `AUTH_URL` | `http://localhost:3000` | production (`https://`); dev default |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client | optional pair |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth app | optional pair |
| `EMAIL_SERVER` | `smtp://127.0.0.1:1025` | production; dev default (mailpit) |
| `EMAIL_FROM` | `Finlytics <no-reply@finlytics.local>` | production; dev default |
| `API_INTERNAL_URL` | `http://127.0.0.1:4000` | dev default; production optional |
Plus the database package's `DATABASE_URL` (and `DB_*`). api side: `API_ALLOWED_ORIGINS` must contain `AUTH_URL`'s origin.

## Tests
- Unit (Vitest): env schema; session-token hashing and the adapter wrapper (hash on every path, raw token returned,
  lifetimes, deleted user, email normalisation, token allowlist); CSP builder; proxy gate; api client status handling;
  ui store; shell components (sidebar collapse keeps content mounted, `[` shortcut, tooltips, sheet, palette, user
  menu) with axe; login form validation.
- e2e (Playwright, Chromium): email magic link via mailpit's API → dashboard → `/v1/me` card shows the user through the
  rewrite → sidebar toggle keeps the same `<main>` node → theme toggle flips `data-theme` and PATCH succeeds → no CSP
  violations → sign out lands on `/login` and `/dashboard` redirects again; ui-only classes are in the app CSS.

## PR checklist
- [ ] `pnpm --filter @finlytics/web typecheck lint test build`
- [ ] `pnpm --filter @finlytics/web test:e2e` (compose up, migrations applied, api built)
- [ ] root `pnpm lint typecheck` and `pnpm --filter @finlytics/eslint-config test`
- [ ] `/review` and `/security-audit` (auth, cookies, CSP)
- [ ] User: add the env variables above to `.env.example`; review the follow-ups (W9, W11, W13)

## Follow-ups
- Promote shell primitives and brand marks to `packages/ui` (W9). Fontsource deps for apps/web (W13).
- Account-theme one-time sync (W11). Server-side api calls (later phases) must forward `Cookie`, `x-request-id` and
  `X-Forwarded-For`, and the Next.js pods go in `API_TRUST_PROXY` (api plan carry-forward).
- Retire or keep `apps/api/scripts/dev-session.mts` (development only) — backend owner.
