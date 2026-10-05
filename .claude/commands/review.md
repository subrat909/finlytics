---
description: Review current git diff for bugs, perf, leaks and rule violations.
---

Use the `code-reviewer` subagent on the current `git diff HEAD`. Then fix every Critical/High finding yourself, re-run `pnpm typecheck && pnpm lint && pnpm test`, and present the remaining Medium/Low findings for my decision.
