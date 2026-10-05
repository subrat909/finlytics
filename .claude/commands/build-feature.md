---
description: Implement an approved plan from docs/plans. Usage - /build-feature <plan-file-name>
---

Implement the approved plan at `docs/plans/$ARGUMENTS.md` task by task.

For each task:
1. Mark it in progress in the plan file.
2. Delegate backend tasks to `backend-engineer`, UI tasks to `frontend-engineer`, broker tasks to `broker-integrator`, Python tasks to `quant-engineer`. Run independent tasks in parallel.
3. After each task run the package's typecheck, lint and tests. Fix failures before moving on.
4. Tick the checkbox in the plan file.

When all tasks are done: run `/review`, then `/security-audit` if auth/broker/orders were touched, then summarise what changed and how to test it manually.
