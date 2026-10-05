---
name: nest-module
description: Template and checklist for creating a NestJS module in apps/api (controller/service/repository/gateway/processor, Zod DTOs, tests). Use when adding backend functionality.
---

# NestJS Module Skill

```
pnpm --filter api nest g module modules/<name> && nest g controller modules/<name> && nest g service modules/<name>
```
Then add `repository.ts`, `dto/index.ts` (re-export zod schemas from `@finlytics/shared`), `__tests__/`.

Controller template:
```ts
@Controller('v1/<names>')
@UseGuards(AuthGuard)
export class <Name>Controller {
  constructor(private readonly svc: <Name>Service) {}
  @Get() list(@CurrentUser() u: User, @Query() q: List<Name>Query) { return this.svc.list(u.id, q); }
  @Post() @Idempotent() create(@CurrentUser() u: User, @Body() dto: Create<Name>Dto) { return this.svc.create(u.id, dto); }
}
```
Checklist: userId scoping · Zod pipe · mapper (no Prisma model leaks) · domain events · audit log for mutations · cursor pagination · unit + integration tests · OpenAPI decorators (`@ApiTags`).
