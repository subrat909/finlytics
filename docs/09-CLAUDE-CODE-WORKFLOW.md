# 09 — Working with Claude Code on Finlytics (beginner guide)

## 1. One-time setup (15 minutes)
1. Install: Node 24 (`nvm install` reads `.nvmrc`; `engines` requires ≥ 24.11), pnpm 10.34.6 (pinned with its integrity hash by `packageManager` in `package.json`: run `corepack enable`, or use any pnpm ≥ 10, which switches to the pinned version by itself; dependency build scripts run only for packages allowlisted in `pnpm-workspace.yaml`), Docker Desktop, Python 3.12 + `uv` (`pip install uv`), Git, VS Code.
2. Install Claude Code: `npm i -g @anthropic-ai/claude-code`, then `claude` once to log in with your Max plan.
3. Unzip this kit as the project root, `cd finlytics`, `git init && git add -A && git commit -m "chore: kickoff kit"`.
   Then `pnpm i`. It also installs the git hooks: pre-commit runs lint-staged (ESLint + Prettier on staged files) and
   commit-msg rejects messages that aren't Conventional Commits (`feat(scope): …`, `fix: …`, `chore: …`).
4. Copy `.env.example` → `.env` and fill the few dev values (AUTH_SECRET: `openssl rand -base64 32`; MASTER_KEY same).
5. `docker compose up -d` (Postgres+Timescale, Redis, Mailpit). Every port is bound to 127.0.0.1: Postgres 5432,
   Redis 6379, Mailpit 8025 (UI) and 1025 (SMTP); Grafana 3001 and Prometheus 9090 start only with
   `--profile observability`. If 5432 or 6379 is already taken, set `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` in `.env`
   and use the same ports in `DATABASE_URL`, `DATABASE_DIRECT_URL` and `REDIS_URL`.
6. Run `claude` in the repo. It reads `CLAUDE.md` automatically. Type `/init`? **No** — we already have CLAUDE.md; skip it.
7. Verify config: `/agents` lists 7 agents; `/help` shows the project commands (`/plan-feature`, …).

## 2. Models, effort and modes — what to use when (Max plan)

| Task | Model | Effort / thinking | Mode |
|---|---|---|---|
| Architecture, planning a feature, DB schema, security audit, broker adapters, quant/agents | **Opus-class (best available: `/model opus`; if your plan lists Fable/Mythos-class, use it here)** | High — type "think hard"/"ultrathink" in the prompt for plans | **Plan mode** (`Shift+Tab` twice) → approve → execute |
| Implementing an approved plan, UI pages, CRUD modules, tests | **Sonnet** (fast, cheap, excellent at following rules) | default | Normal (edits with permission prompts) or **auto-accept edits** (`Shift+Tab` once) inside a git branch |
| Repetitive refactors, renames, docs, commit messages | Sonnet or Haiku | low | auto-accept |
| Code review, perf hunting | Sonnet (code-reviewer agent) / Opus for security | medium | read-only |

Rules of thumb:
- **Plan with the strongest model, build with Sonnet, review with the strongest model.** The subagent files in
  `.claude/agents/` pin architect, broker-integrator, quant-engineer and security-auditor to Opus. backend-engineer,
  frontend-engineer and code-reviewer use `model: inherit`, so they follow `/model`: stay on Opus for maximum quality,
  or switch to `/model sonnet` to build faster and use less of your plan's quota.
- Use **Plan mode for anything touching more than 3 files**. Approve the plan, then let it run.
- Work on a **git branch per feature** (`git switch -c feat/watchlists`). Commit after every green `/review`.
- Keep context small: `/clear` between features; `/compact` when the conversation gets long.
- Check what Claude is doing: `/cost`, `Esc` to interrupt, `Esc Esc` to rewind to an earlier message.
- Never paste broker secrets into chat; put them in `.env` (which Claude is denied from reading by `settings.json`).

## 3. Daily loop (copy-paste prompts)
```
/plan-feature Watchlists: CRUD lists, add/remove/reorder instruments, live prices via /rt, empty+loading+error states
   → read docs/plans/watchlists.md, say "approved" (or edit the plan file)
/build-feature watchlists
/review
/security-audit            (only if auth/broker/orders touched)
git add -A && git commit -m "feat(watchlists): lists with live prices"
```
Other commands: `/ui-page /option-chain Option chain with Greeks`, `/db-change add Alert.cooldownSec`,
`/add-broker Zerodha https://kite.trade/docs/connect/v3/`, `/perf-check apps/web/src/features/option-chain`.

## 4. Plugins / MCP servers worth installing
Run `claude mcp add <name> ...` or use `/plugin` marketplace. Recommended:

| Tool | Why | Install |
|---|---|---|
| **Context7** (docs MCP) | up-to-date docs for Next.js 15, NestJS 11, Prisma 7, Tailwind v4, shadcn | `claude mcp add context7 -- npx -y @upstash/context7-mcp` |
| **Playwright MCP** | Claude opens the app, clicks, screenshots light/dark, checks states | `claude mcp add playwright -- npx -y @playwright/mcp@latest` |
| **Postgres MCP** | Claude inspects tables/explain plans while optimising | `claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres $DATABASE_URL` |
| **GitHub MCP / `gh` CLI** | PRs, issues, CI logs | `gh auth login` (Claude uses `gh` directly) |
| **Sentry MCP** (later) | pull production errors into fixes | per Sentry docs |
| **shadcn MCP** | add components in the project's style | `claude mcp add shadcn -- npx shadcn@latest mcp` |
| **Figma MCP** (optional) | if you design screens first | Figma desktop → Dev Mode MCP |

Also: `/plugin` → browse the official marketplace for *code-review*, *security*, *frontend-design* plugins and
install those that match the stack; the project's own `.claude/` already covers the essentials.

## 5. Where things live
- Rules Claude must follow → `.claude/rules/*.md` (scoped by path globs).
- Reusable know-how → `.claude/skills/*/SKILL.md` (Claude loads when relevant).
- Specialists → `.claude/agents/*.md`. Workflows → `.claude/commands/*.md`.
- Decisions → `docs/*.md`. Feature plans → `docs/plans/*.md` (generated).

## 6. Getting the TradingView library
Apply at https://www.tradingview.com/advanced-charts/ (free, needs approval, ~days). After approval, clone their
private repo and copy `charting_library/` into `apps/web/public/` (gitignored). Until then the Charts page uses
Lightweight Charts automatically (`CHARTS_ENGINE=lightweight`).

## 7. Broker developer accounts
- Upstox: https://account.upstox.com/developer/apps → create app, set redirect URI from `.env.example`, copy key/secret into `.env`.
- Dhan: https://dhanhq.co → DhanHQ Trading APIs → generate access token (30 days); you paste it in the Brokers page, not in `.env`.
