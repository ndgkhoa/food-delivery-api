# Catalog PR #1 Review Fixes — Report

Author: fullstack-developer | Date: 2026-07-27 | Branch: `feat/catalog-menu-crud`
Scope: apply H1, H2, M1, M3, M4 from `code-reviewer-260727-0954-catalog-pr1-hexagonal-review.md`.
Not done (per instructions): M2 optimistic locking (deferred), no generic base-class extraction.

## Per-finding changes

### H2 — whitespace-only name → 400 (not 500)
- `interface/http/dto/create-restaurant.request.ts` — added `@Transform(trim)` (class-transformer) before `@IsNotEmpty()` on `name`; `trim` on `description` too. Local `trim` helper: `typeof value === 'string' ? value.trim() : value`.
- `interface/http/dto/create-menu-item.request.ts` — same treatment on `name` + `description`.
- Update DTOs (`update-restaurant.request.ts`, `update-menu-item.request.ts`) are `PartialType(Create…)` → inherit the transforms automatically; verified by a test on `UpdateRestaurantRequest`.
- Regression test: `interface/http/dto/request-name-trimming.spec.ts` (4 cases: whitespace restaurant/menu-item name rejected, padded name trimmed, inherited update DTO rejected). Runnable without DB.
- e2e: added `rejects a whitespace-only restaurant name with 400` to the e2e spec.

### M1 — no HTTP exceptions in application/domain
- New domain error `domain/shared/errors.ts` → `EntityNotFoundError(entity, entityId, message?)` (framework-free, builds `"<entity> \"<id>\" not found"` by default).
- `application/restaurant/queries/get-restaurant.handler.ts` + `application/menu-item/queries/get-menu-item.handler.ts` — dropped `NotFoundException` import from `@nestjs/common`; now throw `EntityNotFoundError`. Menu-item keeps its detailed message via the 3rd arg so `/not found/i` still matches.
- New edge filter `interface/http/filters/entity-not-found.filter.ts` (`@Catch(EntityNotFoundError)` → HTTP 404 body `{statusCode, message, error:'Not Found'}`).
- Registered globally via `APP_FILTER` in `app.module.ts`. Existing e2e 404 assertions unaffected (filter returns 404).

### H1 — write + audit atomic (single transaction)
Approach chosen: **hand-rolled AsyncLocalStorage unit-of-work** (no new dependency). Rationale: `typeorm-transactional` would add a runtime dep + patch-Repository setup and pull an infra concern toward the wiring; the ALS pattern is ~30 LOC, keeps `TransactionPort` a clean domain port with the adapter fully inside infrastructure, and needs zero schema/library change. KISS + keeps cruiser layer rules trivially satisfied.
- Domain port `domain/shared/transaction.port.ts` → `TransactionPort.runInTransaction<T>(work)` + `TRANSACTION_PORT` symbol.
- `infrastructure/persistence/transaction/transactional-entity-manager.ts` — module-level `AsyncLocalStorage<EntityManager>`; `runWithEntityManager()` + `getTransactionalEntityManager()`.
- `infrastructure/persistence/transaction/typeorm-transaction.adapter.ts` — `@InjectDataSource`; `dataSource.transaction(mgr => runWithEntityManager(mgr, work))`.
- Repos (`typeorm-restaurant.repository.ts`, `typeorm-menu-item.repository.ts`) + audit adapter (`typeorm-audit.adapter.ts`) now resolve the active manager via a private `repository` getter: `getTransactionalEntityManager()?.getRepository(E) ?? this.<injectedRepo>` (falls back to default connection outside a tx).
- Provider `{ provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter }` added+exported in `persistence.module.ts` (module owns the DataSource).
- All 6 command handlers wrap `save()/softDelete()` + `auditPort.record()` in `transaction.runInTransaction(...)`.
- Atomicity test: `infrastructure/persistence/write-audit-atomicity.spec.ts` (testcontainers) — real repo+adapter, audit port stubbed to throw → asserts `findAndCount` total 0 (write rolled back). **You run this** (infra/testcontainers).

### M3 — cascade soft-delete menu_items on restaurant soft-delete
- Port: `domain/menu-item/menu-item.repository.ts` — added `softDeleteByRestaurant(restaurantId, tenantId)`.
- Adapter: `typeorm-menu-item.repository.ts` — `this.repository.softDelete({ restaurantId, tenantId })`.
- `application/restaurant/commands/delete-restaurant.handler.ts` — now injects `MENU_ITEM_REPOSITORY`; inside the H1 transaction: soft-delete restaurant → `softDeleteByRestaurant` → record audit. **Audit decision: one restaurant DELETE entry covers the cascade** (documented in the handler comment); no per-item entries — keeps the ledger's delete event singular and matches the single user action.
- Tests: unit cascade in `menu-item-handlers.spec.ts` (delete restaurant → parent 404s + `findAndCountByRestaurant` total 0); e2e `cascades a soft-delete to menu items when a restaurant is deleted`.

### M4 — test gaps
- (a) menu-item cross-tenant e2e: `does not leak menu items across tenants` (tenant B gets 404 on list + read of tenant A's item).
- (b) audit-atomicity: `write-audit-atomicity.spec.ts` (H1 above).
- (c) whitespace-name 400: DTO unit spec + e2e (H2 above).
- (d) cascade soft-delete: unit + e2e (M3 above).
- Bonus fidelity fix (review M4 nit): `menu-item-handlers.spec.ts` `FakeRestaurantRepository.findById`/`findAndCount` now honor `deletedAt` and `softDelete` actually removes — matches the real adapter contract (needed for the cascade test).

## Constructor signature changes (DI order)
- CreateRestaurant: `(restaurantRepo, tenantCtx, audit, transaction)`
- UpdateRestaurant: `(restaurantRepo, audit, transaction, getRestaurant)`
- DeleteRestaurant: `(restaurantRepo, menuItemRepo, audit, transaction, getRestaurant)`
- CreateMenuItem: `(menuItemRepo, tenantCtx, audit, transaction, getRestaurant)`
- Update/DeleteMenuItem: `(menuItemRepo, audit, transaction, getMenuItem)`
All spec instantiations updated with a `FakeTransactionPort` (`runInTransaction = work => work()`).

## Verification (all green)
- `pnpm biome check .` → exit 0 (the "1 info" is a pre-existing config-schema migration note, not a lint error).
- `pnpm nx build catalog` → webpack compiled successfully.
- `pnpm cruiser` → no violations (99 modules, 314 deps). TransactionPort is a domain port; adapter in infra; filter (interface) imports domain error only.
- `pnpm knip --no-config-hints` → exit 0.
- `pnpm nx test catalog --testPathPatterns='domain|application'` → 4 suites, 27 tests passed.
- DTO regression: `--testPathPatterns='request-name-trimming'` → 4 passed.
- `tsc --noEmit` on `apps/catalog/tsconfig.spec.json` AND `apps/catalog-e2e/tsconfig.spec.json` → exit 0 (typechecks the integration + e2e specs I did not run).
- No new deps installed (class-transformer, @nestjs/typeorm, typeorm already present). No new migration created — `migrations/` still holds only `1753574400000-create-catalog-tables.ts` (M3 is app-level soft-delete, no schema change).

## Not run (you run these, per instructions)
- Infra/integration testcontainers specs (incl. `write-audit-atomicity.spec.ts`) and the catalog e2e suite. They typecheck clean; the atomicity + cascade + cross-tenant + whitespace assertions are the acceptance checks.

## Deviations / notes
- H1 uses hand-rolled ALS UoW rather than `typeorm-transactional` — see rationale above.
- Cascade emits a single restaurant-level audit entry (not per-item) — documented in code.

## Unresolved questions
1. Confirm the single restaurant-DELETE audit entry is acceptable for the cascade (vs. one entry per soft-deleted menu item) for your audit/reporting needs.
2. The 404 filter body mirrors Nest's default shape; if there's a project-standard error envelope, the filter is the one place to align it.

Status: DONE
