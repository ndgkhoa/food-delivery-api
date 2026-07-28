# Red-team review — slice 3b (catalog outbox + Debezium CDC + CQRS read model)

Branch `feat/catalog-outbox-cqrs`. All changes untracked (git diff vs develop empty; reviewed working tree directly). Runtime proven green — this hunt targets correctness the happy path doesn't exercise. Scope: 25 new files under apps/catalog/src/{domain,application,infrastructure,interface}, infra/debezium/, migration, compose.

## Verdict
No **Critical** defects. One **Medium** real read-model-corruption defect (permanent orphan menu-item read rows), one **Medium** broken rollback migration, plus several Low/informational. The tx-atomicity core (the prime suspect #1) is correct.

---

## VERIFIED CORRECT (do not re-check)

- **#1 Idempotency tx boundary.** `catalog-projection.consumer.ts:63-70` wraps `runOnce` in `transaction.runInTransaction`. `typeorm-transaction.adapter.ts:18` publishes the tx `EntityManager` on ALS via `runWithEntityManager`. `typeorm-processed-event.store.ts:34-36`, `typeorm-read-restaurant.repository.ts:22-26`, `typeorm-read-menu-item.repository.ts:22-26` all use the identical `getTransactionalEntityManager()?.getRepository(X) ?? injected` enlist pattern. So `processed_events` insert + read upsert share ONE commit boundary. No dedupe/effect divergence, no ghost row on rollback, no double-apply. Retry re-opens a fresh tx (rolled-back processed row is gone), so transient failure retries cleanly.
- **Duplicate-event abort path is benign.** On redelivery the `processed_events` insert hits 23505 → tx enters Postgres aborted state → `markProcessed` translates to `DuplicateEventError` → `runOnce` returns undefined without running `work`. TypeORM then issues COMMIT on the aborted tx, which pg downgrades to ROLLBACK (no throw). Outcome = no effect, which is exactly the intent for a duplicate. Correct, though it relies on "duplicate ⇒ no writes wanted" — safe here.
- **#2 Per-aggregate ordering.** Single Debezium task tails WAL in commit order, routes by `aggregateid` → same key = same partition = Kafka in-order = consumer in-order. Created→Updated→Deleted preserved *within* an aggregate. No restaurant resurrection (RestaurantUpdated after RestaurantDeleted can't reorder — same partition).
- **#3 Delete out-of-order safety.** `remove`/`removeByRestaurant` use TypeORM `.delete({...})` → no-op (no throw) when no row matches. A `*Deleted` with no prior `Created` is a safe no-op, never poisons the partition. No read soft/hard-delete mismatch: read rows are hard-removed by design (mappers hardcode `deletedAt: null`, entities have no soft-delete col — `read-*.orm-entity.ts`).
- **#4 Upsert = full overwrite, no null clobber.** `toSnapshot()` spreads all props (`restaurant.ts:114`, `menu-item.ts:142`), so every Updated payload carries every field; `.upsert(entity, ['id'])` overwrites all columns. No PATCH semantics. Redelivery of a stale event is blocked by dedupe, so no stale-overwrite hazard.
- **#5 Tenant scoping.** Reads always filter by `tenantId` from context (`get-restaurant-view.handler.ts:26`, `list-restaurants.handler.ts:21`, `list-menu-items.handler.ts:31`, both read repos' `findBy*`). Projection writes `tenantId` from the trusted envelope header (`catalog-read-model-projector.ts:44,52,72`), never payload. Upsert conflict key is a write-model UUID (globally unique across tenants), so no cross-tenant PK collision/overwrite. `decodeHeaders` fails closed on empty/missing `x-tenant-id` (`event-envelope.ts:59`). No tenant leak.
- **#6 CQRS parent validation is on the WRITE model.** `create-menu-item.handler.ts:36` and `list-menu-items.handler.ts:28` both call `GetRestaurantHandler` (write model, strong) before touching the read model — a just-created restaurant never spuriously 404s a child create, and no command reads eventually-consistent state for validation. gRPC cross-service (`get-menu-items-by-ids.handler.ts:24`) and single GET menu item stay on write model (strong) — order service unaffected by projection lag.
- **#7 Connector field mapping.** Outbox columns (`outbox.orm-entity.ts`) line up with EventRouter config (`catalog-outbox-connector.json:22-27`): id→event id + x-event-id, aggregateid→key + x-aggregate-id, type→x-event-type, tenant_id→x-tenant-id, correlationid→x-correlation-id, created_at→x-occurred-at. Projector ignores `occurredAt` entirely, so the removed `event.timestamp` INT64 issue has zero downstream dependency. Payload field names (backfill SQL + `toSnapshot`) match projector snapshot interfaces.
- **Hard rules.** No `phase`/finding-code/audit tokens in code or migration filename (grep clean). All new source files <130 lines. Kebab-case throughout. Hexagonal boundaries intact (domain read-model ports import no infra; `catalog-event.factory` pure). Least-privilege debezium role: REPLICATION + SELECT on `outbox` only, publication scoped to `outbox` (`migration:82-108`) — cannot broaden (CREATE PUBLICATION needs table ownership it lacks).

---

## Medium

### M1 — Permanent orphan menu-item read rows after restaurant delete (cross-partition reorder)
`catalog-read-model-projector.ts:61-64` + `delete-restaurant.handler.ts:37-48`.
Restaurant delete emits ONLY `RestaurantDeleted` (no per-item `MenuItemDeleted`); the projector cascades `removeByRestaurant`. Restaurant events and its menu-item events live on **different partitions** (keyed by different aggregate ids) → no cross-aggregate ordering.

Failure scenario (reachable with a single consumer interleaving two partitions):
1. create R, create M(→R), delete R  (write order; M soft-deleted in write DB, no MenuItemDeleted emitted)
2. Consumer applies `RestaurantCreated`(A), then `RestaurantDeleted`(A) → `removeByRestaurant` (M read row absent yet → no-op), then `MenuItemCreated`(B) → upsert **re-inserts M** into `read_menu_items` pointing at a restaurant no longer in `read_restaurants`.

Result: orphan read row that **never self-heals** (no future event references M). Under churny update-then-delete this accumulates unboundedly.

Impact bounded: `ListMenuItemsHandler` validates the parent against the write model first (R is soft-deleted → 404), so orphans are **not served** through the current API and it's not a tenant leak. But it is silent, permanent read-model corruption + bloat, and a latent exposure if any future query path reads `read_menu_items` without the parent guard.

Fix options: (a) emit explicit `MenuItemDeleted` per cascaded child so deletes ride the item's own partition (ordered w.r.t. its create/update); or (b) a periodic reconciliation/prune job dropping menu-item read rows whose restaurant read row is gone (fits the P5 prune bucket); or (c) accept + document as known eventual-consistency limitation. Recommend (a) for correctness or at minimum (c)+(b).

### M2 — `down` migration cannot drop the debezium role (broken rollback)
`migration:94,116,118`. `up` grants `USAGE ON SCHEMA public` AND `SELECT ON outbox`. `down` revokes only `SELECT ON outbox`, then `DROP ROLE IF EXISTS "debezium"`. Postgres refuses to drop a role that still holds privileges → `ERROR: role "debezium" cannot be dropped because some objects depend on it (privileges for schema public)`. Rollback fails mid-way. Dev-only (rollbacks rarely run in prod) but the migration is not reversible as written. Fix: `REVOKE USAGE ON SCHEMA public FROM "debezium"` (and `REVOKE ALL ON outbox`) before `DROP ROLE`; also terminate/drop the replication slot if active or the drop blocks.

---

## Low / informational

- **L1 — Projection silently disabled on `NODE_ENV==='test'`** (`catalog-projection.consumer.ts:55`). Exact-match gate is reasonable, but if a real deploy accidentally inherits `NODE_ENV=test`, the consumer never starts, read endpoints serve permanently-stale/empty data, and nothing is logged. Prefer an explicit positive flag (e.g. `PROJECTION_ENABLED`) or at least `logger.warn` when the gate short-circuits.
- **L2 — Poison-skip = permanent read-model gap** (`kafka-consumer.ts:59-64`). After `maxAttempts` the failure is swallowed and the offset advances; the `processed_events` row was rolled back and the offset moved past, so a failing `*Created` is lost forever (missing read row). Acceptable per the documented P5 no-DLQ tradeoff and low likelihood (trusted outbox producer), but restate: there is no recovery path for a genuinely un-projectable event without a re-backfill.
- **L3 — `correlationid` nullable in schema vs non-null invariant** (`outbox.orm-entity.ts:31`, `migration:35`). The adapter always mints a UUID and `outbox.port` comments say the column "must be non-null" so the consumer's fail-closed decoder gets an `x-correlation-id`. But the DB allows NULL; a null would drop the header → `MissingEventHeaderError` → poison-skip. Enforce the invariant at the DB: `correlationid uuid NOT NULL`.
- **L4 — backfill count logging is always 0** (`backfill-read-model.ts:58-61`). TypeORM raw `INSERT` without `RETURNING` yields an array shape whose `.length` is not the row count, so the log reports 0 even when rows were inserted. Cosmetic. Use `RETURNING id` or read `result` affected count.
- **L5 — Unbounded outbox + orphaned replication slot growth (shared instance)**. `outbox` is insert-only with no prune (grows with every write; re-running backfill adds a fresh row per live aggregate each run — harmless re-projection via dedupe, but more rows). Connector has no explicit `slot.name` → defaults to `debezium`; if the connector is ever deleted without dropping the slot, Postgres retains WAL indefinitely, and since compose runs ONE postgres instance for all service DBs (catalog/auth/inventory/order), unbounded WAL can fill disk for **every** service. Inherent CDC ops risk (P5) — add outbox retention + slot-cleanup runbook. `wal_level=logical` instance-wide is otherwise benign (other DBs need their own publication+grants the debezium role lacks).
- **L6 — Connector JSON ships plaintext `database.password: "debezium"`** (`catalog-outbox-connector.json:9`). Fine for local dev (matches migration default). Ensure this file is never the source of prod connector config — the migration comment already flags secret injection for real deploys; keep the dev JSON out of prod provisioning.

---

## Unresolved questions
1. M1: is per-item `MenuItemDeleted` emission (option a) in scope for 3b, or is orphan-prune deferred to the P5 reconciliation bucket? Confirm the intended contract.
2. Is `read_menu_items` ever queried by any current/planned path *without* the write-model parent guard (e.g. an admin/report endpoint)? If yes, M1 rises to High.
3. Compose: is the single postgres instance the intended prod topology, or per-service instances? Affects L5 blast radius.

**Status:** DONE_WITH_CONCERNS
**Summary:** Core outbox→CDC→projection tx atomicity, dedupe, ordering, and tenant isolation verified correct; no critical/tenant-leak defects. Two Medium issues: permanent orphan menu-item read rows from cross-partition delete reorder (M1), and a non-reversible down migration (M2).
**Most important finding:** M1 — restaurant delete cascade + cross-partition reorder leaves permanent, self-un-healing orphan rows in `read_menu_items`; currently masked from the API only by the write-model parent guard.
