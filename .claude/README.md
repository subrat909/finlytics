# .claude/ — how Claude Code is configured for Finlytics

| Folder/file      | What it does                                                                                   |
|------------------|------------------------------------------------------------------------------------------------|
| `../CLAUDE.md`   | Master prompt: stack, rules, commands, how to work. Always loaded.                              |
| `rules/*.md`     | Path-scoped rules (security, frontend, backend, broker, ai-engine, testing). Loaded by globs.   |
| `agents/*.md`    | Subagents with their own model & tools: architect, frontend-engineer, backend-engineer, broker-integrator, quant-engineer, security-auditor, code-reviewer. |
| `commands/*.md`  | Slash commands: `/plan-feature`, `/build-feature`, `/review`, `/security-audit`, `/add-broker`, `/ui-page`, `/db-change`, `/perf-check`. |
| `skills/*/SKILL.md` | Reusable know-how Claude loads on demand: finlytics-ui, broker-adapter, nest-module, strategy-engine. |
| `settings.json`  | Permissions (deny reading .env, deny destructive commands), hooks (auto-format on save, block `prisma db push`). |

Copy `settings.local.json.example` to `settings.local.json` for personal overrides (gitignored).
