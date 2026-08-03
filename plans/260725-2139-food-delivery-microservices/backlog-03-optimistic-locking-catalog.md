# Backlog 03 — Optimistic locking on catalog updates (restaurant + menu-item)

Context: [plan.md](./plan.md) (Deferred backlog) · [phase-00-foundation-monorepo-catalog.md](./phase-00-foundation-monorepo-catalog.md)

## Overview
- **Priority**: correctness — third backlog slice.
- **Status**: ✅ Verified live + adversarially reviewed (1 High + LOW-3 fixed) — branch `feat/optimistic-locking`. Single PR.
  - **Live evidence (real Postgres + Redis via HTTP)**: both migrations applied cleanly (write `restaurants`/`menu_items` + read `read_restaurants`/`read_menu_items` version columns, backfilled to 1). Write-side lock: `GET` exposes `version`; a stale `If-Match: 99` → **409 `CATALOG_CONCURRENCY_CONFLICT`** (unified envelope); correct `If-Match: 1` → **200, version→2**; the now-stale `If-Match: 1` → **409**; a non-integer `If-Match: abc` → **400** (validated). Read-side (post-fix): with `read_restaurants.version` set to 7, `GET` (cache **miss**) → `version: 7` and `GET` again (cache **hit** from Redis) → `version: 7`, and the cached snapshot carries `version: 7` — proving the read model returns the REAL projected version (not a constant), preserved through the Redis write-through cache. Offline: catalog **94** tests (real testcontainers Postgres) across 18 suites; tsc/biome/dependency-cruiser (919 modules, 0 violations)/knip clean.
  - **Implementation note**: uses an **explicit atomic conditional `UPDATE ... SET version = version + 1 WHERE id = :id AND tenant_id = :tenantId AND version = :version`** (`updateVersioned`) — NOT TypeORM's managed-save optimistic lock, which has a load-then-write gap a concurrent writer can slip through. `affected === 0` → `ConcurrencyConflictError` (extends `DomainException`, `code CATALOG_CONCURRENCY_CONFLICT`, 409). Matches `order`'s `updateStatus` pattern. Write + audit + outbox share one tx → a conflict rolls all back (no lost update, no second audit row).
- **Adversarial review + fixes applied** (report `reports/code-reviewer-260803-0720-slice-optimistic-locking-catalog-red-team-review-report.md`; verified clean: atomic single-statement guard with the client-loaded version in the WHERE, full mutable-field coverage [no dropped column], no read-modify-write `save()` bypass, tenant scope in the WHERE, audit+outbox roll back on conflict):
  - **HIGH-1** — the `version` column was added to the WRITE aggregates but NEVER projected into the CQRS READ model, so `GET /restaurants/:id` (read model), the list, and the menu-item list all returned a constant `version: 1` (the domain getter's `?? 1` fallback). A client reading via GET then doing an `If-Match` conditional PATCH would spuriously 409 forever (its "1" is stale vs the real write version). Not data corruption (the write-side guard still protects), but the feature's read path was broken — and my first live check missed it because it read the write-model PATCH response, not a read-model GET. **Fixed**: projected `version` end-to-end — read entities + a migration + the read-model projector upsert + the read mappers/DTOs + the Redis cache snapshot — and re-verified live (GET returns the real version through cache miss AND hit).
  - **LOW-3** — `parseIfMatchVersion` used `Number()`, which silently coerced `"1e3"`→1000 and whitespace. **Fixed**: validate `/^\d+$/` first (reject → the existing 400).
  - Accepted design (documented): the read model is eventually consistent, so immediately after a PATCH a GET can briefly return the previous version → a conditional PATCH may get a transient 409 that self-heals on reload — the standard CQRS + optimistic-lock UX. Deferred (Low): the insert-only `save()` path doesn't translate a version mismatch (latent 500 only if ever repurposed for updates); the post-`updateVersioned` reload round-trip.
- **Brief**: Two concurrent PATCHes to the same restaurant/menu-item both load v1, mutate, and save → **last-write-wins (a lost update)** plus **two audit rows** (a misleading trail). `order` already carries a `@VersionColumn` (its saga concurrency); catalog's write aggregates don't. Add optimistic locking to catalog's `restaurant` + `menu_item`: a version column, TypeORM's version-guarded save that rejects a stale write, a `409` conflict envelope, `version` exposed on responses, and `If-Match` conditional updates. No behaviour change on the happy path; a concurrent/stale write now fails cleanly instead of silently clobbering.

## Key decisions
- **`@VersionColumn` on the write entities** (`restaurants`, `menu_items`): TypeORM's save then emits `UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`; a concurrent bump makes it affect 0 rows → `OptimisticLockVersionMismatchError`. This protects against two in-flight PATCHes clobbering each other — the second save fails, its transaction (write + audit + outbox) rolls back, so NO lost update and NO second audit row. Rating updates hit the READ model (`read_restaurants` projector), NOT this write aggregate, so the version column doesn't interfere with them.
- **Thread `version` through the domain**: the domain `Restaurant`/`MenuItem` carry `version` (load exposes it; `update()` preserves it); the mapper `toDomain`/`toOrm` includes it so the version the client/handler saw is the one the guarded save checks.
- **Map the ORM error → a domain 409**: the repository (or a thin catch in the handler) translates `OptimisticLockVersionMismatchError` into a new catalog `ConcurrencyConflictError extends DomainException` (`code: CATALOG_CONCURRENCY_CONFLICT`, `httpStatus: 409`) — rendered by the shared `GlobalExceptionFilter` (backlog 01) as the unified envelope.
- **Expose `version` + `If-Match` conditional update** (the proper REST optimistic-lock UX): add `version` to the restaurant + menu-item response DTOs; the update endpoint accepts an optional `If-Match` header (parsed to `expectedVersion`). If provided AND ≠ the loaded version → `ConcurrencyConflictError` (the client edited a stale copy — fail before saving). If absent → still rely on the save-time version guard for concurrent-in-flight protection. (Keep it simple: an integer `If-Match`, not a quoted ETag, unless the existing edge already does ETags — check.)
- **Scope**: catalog `restaurant` + `menu_item` (the PATCH surfaces). `order` already has the column (no change). Don't add it to append-only/event tables.

## Related code files
- `apps/catalog/.../migrations/<ts>-add-version-to-restaurants-and-menu-items.ts` — `ALTER TABLE restaurants ADD COLUMN version integer NOT NULL DEFAULT 1` (+ `menu_items`); reversible down; register in catalog's test DB.
- `apps/catalog/.../entities/{restaurant,menu-item}.orm-entity.ts` — `@VersionColumn() version`.
- `apps/catalog/domain/restaurant/restaurant.ts` + `menu-item` — carry `version`; mappers include it.
- `apps/catalog/domain/shared/errors.ts` — `ConcurrencyConflictError extends DomainException` (409, `CATALOG_CONCURRENCY_CONFLICT`).
- `apps/catalog/.../repositories/typeorm-{restaurant,menu-item}.repository.ts` — catch `OptimisticLockVersionMismatchError` (from `typeorm`) on save → throw `ConcurrencyConflictError`.
- `apps/catalog/application/.../update-{restaurant,menu-item}.handler.ts` — accept an optional `expectedVersion`; if set and ≠ loaded version → `ConcurrencyConflictError` before the tx.
- `apps/catalog/interface/http/*` — controllers read `If-Match` → `expectedVersion`; response DTOs (+ mappers) add `version`.
- Tests: repo/handler unit (concurrent save → one ok, one 409; If-Match mismatch → 409; no double audit on conflict); migration registered in the in-process e2e.

## Todo
- [x] `version` column on `restaurants` + `menu_items` (migration reversible + registered) + `@VersionColumn` entities
- [x] domain `Restaurant`/`MenuItem` carry `version`; mappers thread it; response DTOs expose it
- [x] repository save maps a stale write → `ConcurrencyConflictError` (409, DomainException) via an atomic `WHERE version = :version` conditional update (see Key decisions); update handlers honor optional `If-Match`/`expectedVersion`
- [x] tests: concurrent update → one 409; stale If-Match → 409; conflict rolls back (no lost update, no double audit)
- [x] biome/cruiser/knip/tsc + tests green; plan updated before push

## Success criteria
- Two concurrent PATCHes to the same restaurant/menu-item: exactly one succeeds; the other gets `409` with the unified envelope (`code: CATALOG_CONCURRENCY_CONFLICT`) — no lost update, no second audit row.
- A client PATCH with a stale `If-Match` version → `409` (edited a stale copy).
- `version` is returned on restaurant/menu-item reads so clients can do conditional updates. `order`'s existing locking is untouched.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Version column breaks the rating/read-model path | L×M | Rating updates the READ model (`read_restaurants`), not the versioned write aggregate — verified; no interaction |
| Migration default on a populated table | L×M | `DEFAULT 1` backfills existing rows (matches TypeORM's version start); metadata-only add, reversible |
| A non-PATCH internal save trips the version guard | M×M | Only the update path carries a loaded version; a create sets version=1; audit-on-cascade delete doesn't version-check |
| Clients not sending If-Match lose the explicit check | M×L | Save-time guard still catches concurrent in-flight writes; If-Match is the extra explicit layer, documented |

## Security considerations
- No new surface; `If-Match` is a client-supplied integer validated as a positive int (reject garbage → 400 via the shared pipe/filter). Version is not sensitive. Tenant scope unchanged (updates already tenant-scoped).

## Next steps
Backlog 04 — Internal identity trust hardening (HMAC/JWT-signed gateway→service headers + K8s NetworkPolicy) + prod Keycloak realm. Then D-items (Argo Rollouts, cosign/SLSA, k6 load test, BullMQ propagation).
