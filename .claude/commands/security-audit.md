---
description: Security audit of changed files (or a path). Usage - /security-audit [path]
---

Use the `security-auditor` subagent on: ${ARGUMENTS:-the files changed in `git diff HEAD --name-only`}.

Also run `pnpm audit --audit-level high` and, if `apps/ai-engine` changed, `uv pip audit` inside it. Report findings as a severity table and propose fixes. Do not apply fixes without my approval.
