# Red-Team Review — Catalog Optimistic Locking (`feat/optimistic-locking`)

Scope: uncommitted diff on `feat/optimistic-locking`. Focus: lost-update closure, field coverage, read-path version exposure, If-Match parsing, tenant scope, tx/audit ordering.

Verdict: **core lost-update protection is sound** (atomic single-statement guard, correct client-loaded version in WHERE, all mutable fields covered, tenant-scoped, audit+outbox inside the tx). **BUT the headline If-Match UX is broken on the read path** — restaurant reads return a hard-coded `version: 1`, producing spurious 409s. One HIGH, one Medium, three Low.

---

## HIGH-1 — Read endpoints return a constant `version: 1`; If-Match conditional updates spuriously 409 after the first mutation

**Where:**
- `apps/catalog/src/infrastructure/persistence/entities/read-restaurant.orm-entity.ts` — no `version` column
- `apps/catalog/src/infrastructure/persistence/mappers/read-restaurant.mapper.ts:6-20` — `toDomain` reconstitutes without `version`
- `apps/catalog/src/domain/shared/restaurant-cache-snapshot.ts` — snapshot has no `version`; `fromRestaurantCacheSnapshot` omits it
- `apps/catalog/src/domain/restaurant/restaurant.ts:114-116` — `get version() { return this.props.version ?? 1 }` → defaults to **1** when absent
- Served by `GetRestaurantViewHandler` (`GET /restaurants/:id`) and `ListRestaurantsHandler` (`GET /restaurants`), both read-model backed. Same defect on `GET /restaurants/:id/menu-items` (list) via `READ_MENU_ITEM_REPOSITORY`.

**Root cause:** the `version` column was added to the **write** aggregates (`restaurants`, `menu_items`) but NOT projected into the CQRS **read** model (`read_restaurants`, `read_menu_items`). The read mappers never populate `version`, so the domain getter falls back to `1` for every read-model-sourced restaurant/list row. `RestaurantResponseMapper.toResponse` then emits `version: 1` unconditionally.

**Repro (restaurant):**
1. `POST /restaurants` → 201, `version: 1` (write model, correct).
2. `PATCH /restaurants/:id` (no If-Match), rename → 200, `version: 2` (write reload, correct).
3. `GET /restaurants/:id` → 200, **`version: 1`** ← stale/wrong (read model, cache-aside).
4. Client uses that value: `PATCH /restaurants/:id` with `If-Match: 1`.
5. Handler loads `before` from the **write** model (`GetRestaurantHandler`, real version = 2); `expectedVersion(1) !== before.version(2)` → **409 `CATALOG_CONCURRENCY_CONFLICT`** for an update that has no actual conflict.

The read model never carries version, so this never self-heals: every conditional update after the first edit fails. The success criterion "version is returned on restaurant/menu-item reads so clients can do conditional updates" (plan line 37) is not met — the returned value is a constant.

**Why CI is green:** handler/repo specs assert against the write model / PATCH-response version. No e2e exercises the real client flow (GET read model → PATCH with If-Match), so the constant-1 exposure is invisible to the suite. Classic passes-CI / breaks-in-prod.

**Blast radius:** false-positive (rejects a legitimate write), not a lost update — the write-model save-time guard still prevents clobbering, so **no data corruption**. The advertised feature is simply non-functional via the normal REST edit flow (GET-to-populate → PATCH-with-If-Match) and emits confusing 409s.

**Asymmetry (see MEDIUM-1):** menu-item **single** GET (`GetMenuItemHandler` → write repo) *does* return the correct version — so restaurant GET and menu-item GET disagree on contract.

**Fix (project version into the read model):**
1. Add `version integer NOT NULL DEFAULT 1` to `read_restaurants` + `read_menu_items` (extend the migration; `synchronize:false`).
2. Carry `version` on `ReadRestaurantRow` / `ReadMenuItemRow`, populate it in `ReadRestaurantMapper.toOrm`/`toDomain`, and include it in the projector upsert's INSERT + `ON CONFLICT DO UPDATE SET` column list (`typeorm-read-restaurant.repository.ts:52-66`).
3. Ensure the outbox event (`CatalogEventFactory.restaurantUpdated`/`menuItemUpdated`) carries `version` so the projector has it.
4. Add `version` to `RestaurantCacheSnapshot` + both snapshot converters (else the cache re-introduces the constant-1).
5. Add an e2e/integration test: create → update → GET → PATCH with the GET's `If-Match` value → 200 (and a stale value → 409).

Note eventual-consistency caveat: even after the fix the read model lags the write model briefly, so a conditional PATCH right after an edit may 409 transiently and resolve on reload — acceptable optimistic-lock semantics, and far better than the current permanent wrong value.

---

## MEDIUM-1 — Inconsistent version contract between restaurant and menu-item single reads

`GET /restaurants/:id/menu-items/:id` → `GetMenuItemHandler` → `MENU_ITEM_REPOSITORY` (write model) → **correct** version.
`GET /restaurants/:id` → `GetRestaurantViewHandler` → read model → **constant 1**.

Same-slice endpoints expose version from different sources, so clients get a truthful version for menu items but a fake one for restaurants (and for both list endpoints). Beyond the correctness bug in HIGH-1, this inconsistency is a maintenance/contract trap. Fixing HIGH-1 (project version into the read model) also removes the asymmetry; keep the source consistent (all reads from read model, or document why menu single GET stays on the write model).

---

## LOW-1 — `save()` repo path does not translate `OptimisticLockVersionMismatchError` → 409

`TypeOrmRestaurantRepository.save` / `TypeOrmMenuItemRepository.save` (`:26-30` / `:24-28`) are currently insert-only (create handlers). But the entities now carry `@VersionColumn`, so if `save()` is ever called on a loaded/existing aggregate, TypeORM emits its own version-guarded UPDATE and throws `OptimisticLockVersionMismatchError` (a `typeorm` error) — unmapped by the `GlobalExceptionFilter` → 500, not the 409 envelope. Latent trap for a future edit path. Either drop the now-redundant public `save()` from the update-capable interface or add the same `ConcurrencyConflictError` translation there. Not exploitable today.

## LOW-2 — Extra `findOne` reload after every `updateVersioned`

`updateVersioned` runs the conditional UPDATE, then a second `findOne` to return the fresh row (`typeorm-restaurant.repository.ts:67-73`, menu `:67-73`). The post-update state is fully known locally (`updated` + `version + 1`); the reload is a second round-trip per write with no correctness benefit. Minor; construct the return from `updated` with an incremented version if you want to shave the query.

## LOW-3 — `If-Match` accepts exponential/whitespace numerics

`parseIfMatchVersion` uses `Number(ifMatch)`: `"1e3"` → `1000`, `" 5 "` → `5` (leading/trailing space tolerated by `Number`). `Number.isInteger` passes both, so they're accepted. Harmless (a wrong number just won't match → 409), and the plan intends a bare integer, but if you want strictness use a `/^\d+$/` test before `Number`. Injection is not possible — the value flows only into a parameterized query. `*`, quoted ETags, `NaN`, `0`, negatives all correctly 400.

---

## Verified-good (do not re-flag)

- **Lost-update window closed:** single atomic `UPDATE ... SET version = version + 1 WHERE id AND tenant_id AND version = :version`; `affected === 0` → `ConcurrencyConflictError`. The `:version` is the client-loaded value (`before` from the write-model get, threaded through immutable `update()` which spreads `...props`) — not a re-read that already advanced.
- **Field coverage complete:** restaurant SET `{name, description, isActive, updatedAt}` == `update()` mutations; menu SET `{name, description, priceCents, isAvailable, updatedAt}` == `update()` mutations. No silently-dropped column.
- **No read-modify-write `save()` bypass on the update path:** both update handlers call `updateVersioned` exclusively; `save()` is used only by the two create handlers (insert).
- **Rating projector isolated:** `updateRating` / read-model `.update(...)` hit `read_restaurants` only — never the versioned write aggregate, never bumps version.
- **Create path clean:** `create()` leaves version undefined (getter → 1); `save()` inserts; no version guard tripped.
- **Tenant scope:** `tenant_id` in the `updateVersioned` WHERE (menu also `restaurant_id`) — a cross-tenant version guess can't touch another tenant's row.
- **Tx / audit ordering:** `updateVersioned` runs first inside `runInTransaction`; a conflict throws before audit/outbox → whole tx rolls back → no stray audit row, no lost update on conflict.
- **409 envelope:** `ConcurrencyConflictError extends DomainException` (`code: CATALOG_CONCURRENCY_CONFLICT`, `httpStatus: 409`) — rendered by the shared filter, consistent with backlog 01.
- **Migration:** reversible `down`, `DEFAULT 1` backfill matches domain start, registered in `catalog-test-database.ts` after the ratings migration, no phase/backlog tokens in name or SQL.
- **Concurrency semantics:** two concurrent PATCHes both WHERE `version=1` → PG row-lock serializes; first commits (v2), second affects 0 → 409. No deadlock, winner's fields persist.

---

## Unresolved questions

1. Is the read-model version staleness (post-fix, eventual consistency) acceptable for the intended clients, or do you want restaurant single GET to read the write model like menu single GET does (strongly-consistent version, no cache)?
2. Should the redundant public `save()` be removed from the update-capable repositories to prevent the LOW-1 latent 500?

**Status:** DONE_WITH_CONCERNS
**Summary:** Lost-update protection is correct and well-built, but the read model was never given a `version` column, so restaurant GET/list (and both list endpoints) return a constant `version: 1` — the If-Match conditional-update feature spuriously 409s after the first edit (HIGH-1). No data-corruption risk; core write-guard holds.
**Concerns:** HIGH-1 (read-model version not projected → broken If-Match UX, unmet success criterion, no e2e coverage) must be fixed before this ships as "conditional updates work". MEDIUM-1 contract asymmetry and three Lows are secondary.
