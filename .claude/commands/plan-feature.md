---
description: Plan a feature end-to-end before coding (uses the architect agent). Usage - /plan-feature <feature name or description>
---

Use the `architect` subagent to produce an implementation plan for: $ARGUMENTS

Requirements for the plan:
- Follow `CLAUDE.md`, `docs/01-ARCHITECTURE.md`, `docs/02-FOLDER-STRUCTURE.md`, `docs/04-API-DESIGN.md`.
- List exact files to create/modify, Prisma changes, Zod schemas, REST/WS/job contracts, UI pages & states, tests.
- Confirm the broker 12-endpoint budget is respected and WebSocket count is unchanged.
- Break into PR-sized tasks with a checkbox list.

Save the plan to `docs/plans/<kebab-feature-name>.md` and then STOP and wait for my approval. Do not write application code.
