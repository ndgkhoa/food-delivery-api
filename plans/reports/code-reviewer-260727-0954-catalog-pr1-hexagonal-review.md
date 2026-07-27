# Catalog PR #1 Review — `feat/catalog-menu-crud` → `develop`

Reviewer: code-reviewer | Date: 2026-07-27
Scope: `apps/catalog/src/**`, `apps/catalog-e2e/**`, migration, modules. Diff base `origin/develop` (empty).
Method: read every source + test file; evidence-based. Automated gates already green (biome, cruiser, knip, build, 37+8+5 tests, migration) — NOT re-reported.

## Merge Verdict: **APPROVE WITH NITS** (2 should-fix-before-merge, rest follow-up)

Strong hexagonal implementation. Ports/adapters clean, tenant scoping present on every read/write, no tenantId spoofing surface, prices in integer cents, soft-delete correct, response mappers drop `deletedAt`. Two genuine defects worth fixing before merge (whitespace-name 500, write+audit atomicity), the rest are follow-ups appropriate for a learning/portfolio backlog. None are cross-tenant leaks.

---

## Critical
None. (No cross-tenant leak, no injection, no secret/PII/stack-trace exposure found. All queries filter by `tenant_id`; DTO whitelist strips any client-supplied `tenantId`.)

---

## High

### H1 — Write + audit are not atomic; audit invariant can be violated
`create-restaurant.handler.ts:32-39`, `update-restaurant.handler.ts:24-32`, `delete-restaurant.handler.ts:20-27` (and the 3 menu-item twins). `repository.save()`/`softDelete()` and `auditPort.record()` run in **two separate DB transactions**.
Failure scenario: entity write commits, then the audit insert throws (jsonb serialize error, connection blip, constraint) → the row is mutated/deleted with **no audit row**, silently breaking the "one immutable row per write" guarantee (`audit-log.orm-entity.ts:4-8`). For DELETE the window is worse: data gone, no trail. No outbox/retry either.
Fix: wrap the domain write + audit in one transaction (`dataSource.transaction(...)` or a QueryRunner-based unit-of-work injected into the handlers) so both commit or both roll back. Since this is the whole point of an audit ledger, worth doing before merge or as the very next task.

### H2 — Whitespace-only `name` returns HTTP 500 instead of 400
`create-restaurant.request.ts:4-7` / `create-menu-item.request.ts:12-15` use `@IsNotEmpty()`, which passes for `"   "` (class-validator only rejects `''`/null/undefined). The value then reaches `Restaurant.create` → `assertValidName` trims to `''` → throws a plain `Error` (`restaurant.ts:29-31`, `menu-item.ts:35-37`). Nest maps an unhandled non-HttpException to **500 Internal Server Error**.
Failure scenario: `POST /api/v1/restaurants` body `{"name":"   "}` → 500 (should be 400 validation error). Same for menu-item name.
Fix (either): (a) trim + reject at DTO — `@Transform(({value}) => value?.trim())` before `@IsNotEmpty()`, or `@Matches(/\S/)`; or (b) add an interface-layer exception filter mapping domain validation errors → 400. (a) is simplest and keeps the boundary honest. Cheap; recommend before merge.

---

## Medium

### M1 — `NotFoundException` (HTTP concern) thrown from the application layer
`get-restaurant.handler.ts:10,25` and `get-menu-item.handler.ts:10,24` import `NotFoundException` from `@nestjs/common`. This is the smell the refactor report already flagged. dependency-cruiser permits it (it's not an "outward"/infrastructure import), but the application layer now hard-codes an HTTP transport concern: a future non-HTTP caller (queue consumer, gRPC, scheduled job) would surface an HTTP 404. It also means the 404-vs-500 contract lives in the use case, not the edge.
Fix: throw a domain-level `RestaurantNotFoundError` / `MenuItemNotFoundError`, translate to 404 in an interface-layer exception filter. Low risk, improves layer purity. Follow-up, not blocking.

### M2 — No optimistic locking → silent lost updates + misleading audit
No `@VersionColumn` anywhere (grep-confirmed). Two concurrent `PATCH` on the same restaurant each read `before`, each `save()` → last-write-wins silently, and **both** emit UPDATE audit rows whose `before` snapshots overlap, so the ledger misrepresents the real transition order.
Low frequency for catalog CRUD, but you asked to flag if real: it is real, just low-probability. Fix: add `@VersionColumn` to the ORM entities and use TypeORM optimistic lock on save; surface a 409 on conflict. Follow-up.

### M3 — Soft-deleting a restaurant orphans its menu_items (no soft-delete cascade)
Migration `menu_items.restaurant_id ... ON DELETE CASCADE` (`1753574400000-create-catalog-tables.ts:35`) only fires on a **hard** DELETE. The app only ever soft-deletes (`@DeleteDateColumn`). So after `DELETE /restaurants/:id`, the restaurant row gets `deleted_at` set but its menu_items keep `deleted_at = NULL`. They become API-inaccessible (parent 404s in `list-menu-items.handler.ts:24`), yet remain "live" rows in the table — dangling from reporting/analytics and any future direct query.
Fix: when soft-deleting a restaurant, cascade a soft-delete to its menu_items (application-level, in a transaction — ties into H1), or document that menu_items are intentionally retained. Follow-up.

### M4 — Test coverage gaps on the audit + tenant-isolation critical paths
- No test exercises the **audit failure / atomicity** path (because H1's transaction doesn't exist yet) — add once H1 lands.
- e2e (`catalog-restaurants-menu-crud.e2e-spec.ts`) covers restaurant cross-tenant isolation (line 117) but **not** menu-item cross-tenant isolation, nor GET/PATCH/DELETE of a menu item under another tenant's restaurant end-to-end (only create is unit-tested at `menu-item-handlers.spec.ts:160`).
- No test for the H2 whitespace-name case (adding one now would fail and expose the bug — good regression guard).
- Fake fidelity nit: `FakeRestaurantRepository.findById` in `menu-item-handlers.spec.ts:28-31` ignores `deletedAt`, unlike the restaurant-spec twin (`restaurant-handlers.spec.ts:27`); a soft-deleted parent would still resolve in menu-item unit tests. Minor divergence from the real adapter contract.

---

## Low / Nits

- **L1 — Timestamp source-of-truth is triplicated**: domain `create/update` set `createdAt/updatedAt` (`restaurant.ts:49,108`), ORM has `@Create/@UpdateDateColumn`, migration has `DEFAULT now()`. Handlers re-map the persisted entity (`saved`) back to domain before snapshotting, so audit `after` stays accurate — no live bug, but three authorities for one value is confusing. Pick one (DB-managed) and let the domain treat them as read-only-after-persist.
- **L2 — No-op `PATCH` still writes an UPDATE audit row** with `before ≈ after` and bumps `updatedAt` (`update-*.handler.ts`). Consider short-circuiting when no fields change to avoid audit noise.
- **L3 — `tenantId` echoed in responses** (`restaurant-response.mapper.ts:8`, `menu-item-response.mapper.ts:8`). It's the caller's own tenant so not a leak, but it's needless surface — consider omitting.
- **L4 — Cannot null-out `description` via API**: `UpdateRestaurantRequest`/`UpdateMenuItemRequest` inherit `@IsString()` (PartialType), so a client cannot send `description: null` to clear it, even though the domain/`UpdateProps` support `string | null`. Minor contract gap.
- **L5 — Stale comment**: `data-source.ts:6-11` references the `typeorm-ts-node-commonjs` CLI, but commit `532dda5` switched migrations to `tsx`. Update the comment.
- **L6 — `getActor()` fallback drift**: adapter defaults to `'system'` (`als-tenant-context.adapter.ts:37`) while the interceptor defaults missing actor to `'anonymous'` (`tenant-context.interceptor.ts:44`). Harmless (audit always runs inside a context) but two different "unknown actor" sentinels.
- **L7 — DRY**: restaurant vs menu-item handlers/repos/mappers/fakes are near-duplicates. For **2** aggregates this is the right call (KISS/YAGNI) — do NOT extract a generic base yet; revisit only if a 3rd aggregate arrives.

---

## Positive Observations
- Tenant scoping is genuinely end-to-end: every `findById`/`findAndCount`/`softDelete` takes `tenantId` from `getTenantIdOrThrow()` (fail-closed), never from client body. DTO `whitelist + forbidNonWhitelisted` (`main.ts:16-22`) blocks tenant spoofing. Verified no query path omits the filter.
- Audit actor/tenant read from context inside the adapter (`typeorm-audit.adapter.ts:25-26`), not passed by callers — spoof-resistant by construction.
- ALS interceptor pattern is correct: `storage.run(...)` wraps the synchronous subscription to `next.handle()`, so awaited continuations inherit the store (`tenant-context.interceptor.ts:46-50`). Fail-closed `getTenantIdOrThrow`.
- Integer-cents modeled + validated at both DTO (`@IsInt @Min(0)`) and domain (`assertValidPriceCents`) layers; ORM/migration use `integer`.
- Immutable aggregates with `create` (invariants) vs `reconstitute` (rehydrate) split is textbook.
- Integration tests hit real Postgres via testcontainers and round-trip the mappers — mapper correctness is covered without brittle mocks.
- Menu-item nesting verifies parent ownership + tenant before create/list (`create-menu-item.handler.ts:34`, `list-menu-items.handler.ts:24`).

---

## Recommended Actions (priority order)
1. **H2** — trim/reject whitespace name at DTO (5-min fix, before merge).
2. **H1** — wrap write + audit in a transaction (before merge or first follow-up; it's the audit ledger's core guarantee).
3. **M3** — decide cascade-soft-delete vs documented retention for menu_items.
4. **M1 / M2** — domain not-found exceptions + optimistic locking (layer purity + concurrency).
5. **M4** — add menu-item cross-tenant e2e + whitespace-name regression test.
6. Low items L1–L7 as cleanup.

---

## Unresolved Questions
1. H1: is audit allowed to be best-effort (log-and-continue) or must it be atomic with the write? Enterprise framing implies atomic — confirm intended guarantee.
2. M3: are menu_items meant to survive their parent restaurant's soft-delete (for restore/history), or should they cascade? Product decision.
3. Is `x-actor-id` ever trusted for anything security-relevant pre-auth, or purely audit metadata? (Currently audit-only, which is fine.)
