---
description: Make a schema change safely. Usage - /db-change <description>
---

For the schema change "$ARGUMENTS":
1. Edit `packages/database/prisma/schema.prisma` (add indexes for new query patterns; keep `userId` scoping; Decimal for money).
2. `pnpm db:migrate --name <snake_case>`; if a Timescale hypertable/retention policy is needed, add a raw SQL migration file.
3. Update Zod schemas in `packages/shared` and mappers in the affected NestJS module.
4. Run `pnpm --filter database generate && pnpm typecheck && pnpm test`.
5. Summarise backward-compatibility implications (is it a zero-downtime migration?).
