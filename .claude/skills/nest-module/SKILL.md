---
name: nest-module
description: Template and checklist for creating a NestJS module in apps/api (controller/service/repository/gateway/processor, Zod DTOs, tests). Use when adding backend functionality.
---

# NestJS Module Skill

There is no generator: apps/api has no Nest CLI (plain `tsc`, plan phase-0-api-bootstrap D1). Copy the template below,
or an existing module such as `apps/api/src/modules/settings/`, into `apps/api/src/modules/<name>/`:
`<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.repository.ts`, `dto/index.ts`
(`createZodDto` over zod schemas from `@finlytics/shared`), `__tests__/`. Register the module in
`AppModule.forRoot` (`apps/api/src/app.module.ts`).

Guards are global (`CsrfGuard` → `SessionGuard` → `RateLimitGuard` → `AuthGuard`): every route needs a session unless
it is marked `@Public()`. Never add `@UseGuards(AuthGuard)`.

Controller template:
```ts
@Controller('v1/<names>')
export class <Name>Controller {
  constructor(private readonly svc: <Name>Service) {}
  @Get() list(@CurrentUser() u: AuthIdentity, @Query() q: List<Name>QueryDto) { return this.svc.list(u.userId, q); }
  @Post() @Idempotent() @RateLimit('orders') // @Idempotent(): trading mutations; @RateLimit('orders'): order placement only
  create(@CurrentUser() u: AuthIdentity, @Body() dto: Create<Name>Dto) { return this.svc.create(u.userId, dto); }
}
```
Repository: query through `this.prisma.db` (the tenancy-guarded client), never `this.prisma.unscoped`:
```ts
list(userId: string, q: List<Name>Query) { return this.prisma.db.<model>.findMany({ where: { userId }, select: { … } }); }
```
Checks: `pnpm --filter @finlytics/api typecheck`, `pnpm --filter @finlytics/api lint`, `pnpm --filter @finlytics/api test`,
`pnpm exec turbo run test:integration --filter=@finlytics/api`.

Checklist: userId scoping · Zod pipe · mapper (no Prisma model leaks) · domain events · audit log for mutations · cursor pagination · unit + integration tests · OpenAPI decorators (`@ApiTags`).
