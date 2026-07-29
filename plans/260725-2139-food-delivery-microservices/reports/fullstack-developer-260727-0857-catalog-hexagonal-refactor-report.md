# Catalog Hexagonal Refactor Report

Branch `feat/catalog-menu-crud`. Refactored `apps/catalog` from NestJS feature-module layout into full Clean/Hexagonal architecture per `plans/260725-2139-food-delivery-microservices/hexagonal-service-architecture.md`. Behavior preserved (same routes, DTOs semantics, table schema, migration). No commit/push made — working tree only.

## (a) Full new file tree

```
apps/catalog/src/
├── main.ts
├── app.module.ts                                              # composition root
├── domain/
│   ├── restaurant/
│   │   ├── restaurant.ts                                      # plain class, create()/reconstitute()/update()/toSnapshot()
│   │   ├── restaurant.repository.ts                            # port + RESTAURANT_REPOSITORY token
│   │   └── restaurant.spec.ts                                  # unit — invariants/factories
│   ├── menu-item/
│   │   ├── menu-item.ts
│   │   ├── menu-item.repository.ts                              # port + MENU_ITEM_REPOSITORY token
│   │   └── menu-item.spec.ts
│   └── shared/
│       ├── audit-action.ts                                     # AuditAction enum
│       ├── audit.port.ts                                       # AuditPort + AUDIT_PORT token
│       ├── tenant-context.port.ts                                # TenantContextPort + TENANT_CONTEXT_PORT token
│       └── pagination.ts                                        # Pagination / PageResult / PaginatedResult
├── application/
│   ├── restaurant/
│   │   ├── commands/create-restaurant.handler.ts
│   │   ├── commands/update-restaurant.handler.ts
│   │   ├── commands/delete-restaurant.handler.ts
│   │   ├── queries/list-restaurants.handler.ts
│   │   ├── queries/get-restaurant.handler.ts                    # also used by menu-item handlers
│   │   └── restaurant-handlers.spec.ts                          # unit — in-memory fake repo/audit/tenant ports
│   └── menu-item/
│       ├── commands/create-menu-item.handler.ts
│       ├── commands/update-menu-item.handler.ts
│       ├── commands/delete-menu-item.handler.ts
│       ├── queries/list-menu-items.handler.ts
│       ├── queries/get-menu-item.handler.ts
│       └── menu-item-handlers.spec.ts
├── infrastructure/
│   ├── persistence/
│   │   ├── entities/restaurant.orm-entity.ts
│   │   ├── entities/menu-item.orm-entity.ts
│   │   ├── entities/audit-log.orm-entity.ts
│   │   ├── mappers/restaurant.mapper.ts                         # toDomain/toOrm
│   │   ├── mappers/menu-item.mapper.ts
│   │   ├── repositories/typeorm-restaurant.repository.ts        # implements RestaurantRepository
│   │   ├── repositories/typeorm-restaurant.repository.spec.ts   # integration (testcontainers) — NOT run by me
│   │   ├── repositories/typeorm-menu-item.repository.ts         # implements MenuItemRepository
│   │   ├── repositories/typeorm-menu-item.repository.spec.ts    # integration (testcontainers) — NOT run by me
│   │   ├── migrations/1753574400000-create-catalog-tables.ts    # unchanged content, moved
│   │   ├── typeorm-options.ts                                   # buildDataSourceOptions, catalogOrmEntities
│   │   ├── data-source.ts                                       # CLI DataSource (migration scripts)
│   │   └── persistence.module.ts                                # forRootAsync + forFeature + binds both repo tokens
│   ├── audit/
│   │   ├── typeorm-audit.adapter.ts                              # implements AuditPort
│   │   └── audit.module.ts
│   └── tenancy/
│       ├── als-tenant-context.adapter.ts                         # implements TenantContextPort (AsyncLocalStorage)
│       ├── als-tenant-context.adapter.spec.ts                    # unit, no DB
│       ├── tenant-context.interceptor.ts                         # dev-only x-tenant-id trust
│       └── tenancy.module.ts                                     # @Global()
└── interface/http/
    ├── restaurants.controller.ts
    ├── menu-items.controller.ts
    ├── dto/create-restaurant.request.ts / update-restaurant.request.ts / restaurant.response.ts
    ├── dto/create-menu-item.request.ts / update-menu-item.request.ts / menu-item.response.ts
    ├── dto/pagination.request.ts / paginated.response.ts
    └── mappers/restaurant-response.mapper.ts / menu-item-response.mapper.ts

apps/catalog/src/testing/catalog-test-database.ts   # unchanged location, imports updated
```

2571 LOC across `apps/catalog/src` (up from ~1050 pre-refactor — expected, hexagonal splits one service class into model + port + handlers + adapter + mapper + DTOs).

## (b) Old → new mapping

| Old | New | Notes |
|---|---|---|
| `app/app.module.ts` | `app.module.ts` (src root) | composition root; now wires ports→adapters + registers 10 handlers as providers |
| `restaurants/entities/restaurant.entity.ts` | `domain/restaurant/restaurant.ts` + `infrastructure/persistence/entities/restaurant.orm-entity.ts` | split: plain domain model (private ctor, `create()`/`reconstitute()`/`update()`) vs TypeORM entity (class renamed `RestaurantOrmEntity`) |
| `restaurants/restaurants.service.ts` | `application/restaurant/{commands,queries}/*.handler.ts` (5 files) | one method → one handler class; id now generated via `randomUUID()` in `CreateRestaurantHandler` (was DB-default `gen_random_uuid()`, functionally identical) |
| `restaurants/restaurants.controller.ts` | `interface/http/restaurants.controller.ts` | now injects 5 handlers instead of 1 service; maps domain→response via `RestaurantResponseMapper` |
| `restaurants/dto/*.dto.ts` | `interface/http/dto/*.request.ts` | renamed `*Dto`→`*Request`, unchanged validators |
| `restaurants/restaurants.module.ts` | dissolved | providers/controllers registered directly in `app.module.ts`; `PersistenceModule` binds `RESTAURANT_REPOSITORY` |
| `menu-items/*` | mirrors restaurant mapping under `menu-item` (singular, matches domain folder convention) | same pattern |
| `audit/audit-action.enum.ts` | `domain/shared/audit-action.ts` | pure enum, no NestJS/TypeORM |
| `audit/audit-log.entity.ts` | `infrastructure/persistence/entities/audit-log.orm-entity.ts` | renamed class `AuditLogOrmEntity` |
| `audit/audit.service.ts` | `domain/shared/audit.port.ts` (interface) + `infrastructure/audit/typeorm-audit.adapter.ts` (impl) | port/adapter split |
| `audit/audit.module.ts` | `infrastructure/audit/audit.module.ts` | binds `AUDIT_PORT`→`TypeOrmAuditAdapter` |
| `common/pagination-query.dto.ts` | `domain/shared/pagination.ts` (types) + `interface/http/dto/pagination.request.ts` (validated request DTO) | `PaginatedResult<T>` now domain-level type shared by app layer |
| `database/data-source.ts` | `infrastructure/persistence/data-source.ts` | unchanged content |
| `database/database.module.ts` | folded into `infrastructure/persistence/persistence.module.ts` | `forRootAsync` connection + `forFeature` entities + repo-token bindings, one module |
| `database/typeorm-options.ts` | `infrastructure/persistence/typeorm-options.ts` | `catalogEntities`→`catalogOrmEntities`; entities import renamed ORM classes |
| `database/migrations/*.ts` | `infrastructure/persistence/migrations/*.ts` | unchanged content, same filename (no "phase" token, already compliant) |
| `tenancy/tenant-context.service.ts` | `domain/shared/tenant-context.port.ts` (interface) + `infrastructure/tenancy/als-tenant-context.adapter.ts` (impl) | port/adapter split; `getTenantIdOrThrow` error now a named `TenantContextNotSetError` class (file-private) |
| `tenancy/tenant-context.interceptor.ts` | `infrastructure/tenancy/tenant-context.interceptor.ts` | injects `TENANT_CONTEXT_PORT` token instead of concrete service |
| `tenancy/tenancy.module.ts` | `infrastructure/tenancy/tenancy.module.ts` | binds `TENANT_CONTEXT_PORT`→`AlsTenantContextAdapter`, still `@Global()` |
| `tenancy/tenant-context.service.spec.ts` | `infrastructure/tenancy/als-tenant-context.adapter.spec.ts` | same 4 test cases, retargeted at the adapter |
| `restaurants/restaurants.service.spec.ts` + `menu-items/menu-items.service.spec.ts` | `application/restaurant/restaurant-handlers.spec.ts` + `application/menu-item/menu-item-handlers.spec.ts` | rewritten as fast in-memory-fake unit tests (no DB) per test-strategy in spec; same scenarios (tenant scoping, soft-delete-hidden, audit-called, before/after snapshot) |
| (new) | `infrastructure/persistence/repositories/typeorm-{restaurant,menu-item}.repository.spec.ts` | new integration tests (testcontainers) covering repo CRUD + mapper round-trip; NOT run in this session (Docker) |

## (c) Verification outputs

**`pnpm nx build catalog`** — pass:
```
webpack compiled successfully
```

**`pnpm biome check .`** — clean (1 pre-existing `biome.json` deprecation info notice, unrelated to this change):
```
Checked 95 files in 49ms. No fixes applied.
Found 1 info.
```
(Ran once with `--write` first to auto-fix import ordering/formatting across 22 new files; manually fixed 2 unused-parameter lints in `menu-item-handlers.spec.ts` fakes by prefixing with `_`.)

**`pnpm cruiser`** — pass, 0 violations of the 3 new hexagonal rules (already present in `.dependency-cruiser.js` from a prior setup step) + existing rules:
```
✔ no dependency violations found (92 modules, 271 dependencies cruised)
```

**`pnpm knip --no-config-hints`** — clean (fixed 1 finding: made `TenantContextNotSetError` file-private instead of exported, since nothing outside the file used it):
```
(no output — 0 issues)
```

## (d) Test suites run vs left for the user

Ran (no Docker needed):
- `domain/restaurant/restaurant.spec.ts`, `domain/menu-item/menu-item.spec.ts` — pure invariant/factory tests
- `application/restaurant/restaurant-handlers.spec.ts`, `application/menu-item/menu-item-handlers.spec.ts` — in-memory fake repos/ports
- `infrastructure/tenancy/als-tenant-context.adapter.spec.ts` — AsyncLocalStorage, no DB

Result: **4 test suites, 26+4 = 30 tests, all passing** (`jest --testPathPatterns "(domain|application)/.*\.spec\.ts$"` → 26 passed; tenancy adapter spec run separately → 4 passed).

Left for you (require Docker/testcontainers, per instructions):
- `infrastructure/persistence/repositories/typeorm-restaurant.repository.spec.ts`
- `infrastructure/persistence/repositories/typeorm-menu-item.repository.spec.ts`
- `apps/catalog-e2e/src/catalog-restaurants-menu-crud.e2e-spec.ts`

I verified these three compile clean via `tsc --noEmit` against `apps/catalog/tsconfig.spec.json` and `apps/catalog-e2e/tsconfig.spec.json` (no output = no errors), but did not execute them.

## (e) Path/config files updated

- `package.json` — `migration:generate/run/revert` scripts: `-d apps/catalog/src/database/data-source.ts` → `-d apps/catalog/src/infrastructure/persistence/data-source.ts`
- `knip.json` — entry `apps/catalog/src/database/data-source.ts` → `apps/catalog/src/infrastructure/persistence/data-source.ts`
- `apps/catalog-e2e/src/catalog-restaurants-menu-crud.e2e-spec.ts` — dynamic `import('../../catalog/src/app/app.module')` → `import('../../catalog/src/app.module')`; testcontainers-after-env-set pattern and `SharedConfigModule` NODE_ENV=test skip preserved untouched
- `apps/catalog/src/main.ts` — `import { AppModule } from './app/app.module'` → `'./app.module'`
- `apps/catalog/src/testing/catalog-test-database.ts` — migration import + `catalogEntities`→`catalogOrmEntities` import path updated to new `infrastructure/persistence/*` location; table names/truncate SQL unchanged (schema untouched)

## (f) Deviations + design decisions

1. **ID generation moved to application layer.** Original TypeORM `@PrimaryGeneratedColumn('uuid')` relied on the DB's `gen_random_uuid()` default at insert time. Domain aggregates need an identity at construction (`Restaurant.create()` requires `id`), so command handlers now generate the id via `randomUUID()` (Node built-in) before calling `create()`. The ORM column still has the DB default as a safety net, but the app always supplies an explicit id. Functionally identical (still a random v4-like UUID), verified by e2e-compiled types and unit tests.
2. **Audit `before`/`after` use `toSnapshot()`, not raw ORM entities.** Original code passed whole TypeORM entity instances into jsonb columns (relying on default `JSON.stringify` enumerable-property serialization). Domain models use getters (not own enumerable properties), so `Restaurant`/`MenuItem` expose an explicit `toSnapshot(): Record<string, unknown>` for this purpose — kept separate from the persistence mapper (mapper uses typed getters directly, no `any`/casts).
3. **`AuditModule` and `PersistenceModule` both independently call `TypeOrmModule.forFeature([AuditLogOrmEntity])`.** Matches the original architecture (original `AuditModule` also self-declared its `forFeature` independent of `DatabaseModule`) — both resolve against the single default TypeORM connection registered by `PersistenceModule.forRootAsync`. Avoids `PersistenceModule` needing to export `TypeOrmModule` just for one entity.
4. **`GetRestaurantHandler` is depended on by menu-item application handlers** (create/list/update/delete) to 404 + tenant-scope-check the parent restaurant — same responsibility the original `MenuItemsService` delegated to `RestaurantsService.findOne`. This is an application→application dependency, allowed under the cruiser rules (only `application→infrastructure|interface` is forbidden).
5. **`NotFoundException`/`BadRequestException` from `@nestjs/common` used directly in application/infrastructure layers** (not a hand-rolled domain error type) — matches original behavior exactly and avoids introducing an unneeded error-mapping layer (YAGNI); `@nestjs/common` is a framework import, not a same-app layer import, so it isn't touched by the 3 hexagonal cruiser rules (which only match `apps/*/src/(domain|application|infrastructure|interface)/` paths on both sides).
6. Domain repository ports return `{ data, total }` (`PageResult<T>`); application handlers add `page`/`limit` to produce `PaginatedResult<T>` — keeps the port from carrying request-echo fields it doesn't need.

No deviations from file/directory layout in the spec. No unresolved questions.

**Status: DONE**
