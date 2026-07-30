# Slice 7a — Partition `orders` by month + partition-maintenance job

Context: [phase-07.md](./phase-07-data-scaling.md) · [phase-02.md](./phase-02-order-core-inventory.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P2 — first P7 slice (foundational data-tier scaling; read-replica 7b + cache 7c build later).
- **Status**: ✅ Verified live (adversarial review in progress) — branch `feat/orders-partitioning`. Migration ran on the REAL order DB (**1334 rows**): count preserved 1334→1334, `orders` now RANGE-partitioned (relkind p) with `orders_p202607`/`orders_p202608`/`orders_default`, and **EXPLAIN pruning** confirmed (a July-bounded query scans ONLY `orders_p202607`). **down/up reversibility proven live**: `migration:revert` → 1334 rows + plain table + `order_items` FK restored; `migration:run` again → 1334 rows + partitioned — data-safe BOTH directions. In-process testcontainers e2e over the partitioned schema: partition-pruning **1/1**, place-cancel **4/4**, idempotency + no-oversell pass; order unit **79**. Maintenance job (idempotent, boot + monthly cron, test-guarded). `@nestjs/schedule@6.1.3`. Offline gates clean.
- **Adversarial review + fixes applied** (report `reports/code-reviewer-260730-2316-slice-7a-orders-partitioning-red-team-review-report.md`; **NO Critical** — the migration is SOLID: all 13 columns + 5 CHECKs + both indexes + composite PK preserved on up, down() faithfully restores id-only PK + FK + CHECKs with a parity guard, FK-drop safe (grep confirms zero hard-DELETE of `orders`), composite-PK repo/optimistic-lock paths correct, atomic rollback). Both real gaps were in the maintenance job (DEFAULT-mitigated → no data loss, only silent pruning degradation), now fixed:
  - **M1** — the job ensured only NEXT month, so a >1-month outage (or booting into an un-created month) dropped rows to DEFAULT permanently (a later `CREATE PARTITION OF` overlaps DEFAULT's rows → fails). **Fixed**: `ensureUpcomingPartitions` now ensures the **CURRENT and NEXT** month on boot + cron, so whatever month the service starts in gets its partition before serving traffic (unit-tested).
  - **M2** — partition bounds weren't UTC-pinned (session-TZ-dependent → gap/overlap risk). **Fixed**: bounds pinned to explicit `+00` (unit-tested + live-confirmed the CREATE SQL is valid and coexists).
  - **L** (deferred): swallowed DDL errors need a metric/alert — P8 observability. Retention (drop old partitions) — documented follow-up.
- All re-verified: order unit **81** (+2 maintenance tests); the up/down/pruning live evidence above stands. **Completes 7a.**
- **Brief**: Convert `orders` to a **declarative monthly RANGE-partitioned** table on `created_at`, migrating the existing rows without loss, and add a scheduled **partition-maintenance job** that pre-creates next month's partition. Order queries stay transparent (the repository is unchanged — partitioning is invisible to SQL); the payoff is **partition pruning** (verified by EXPLAIN) on time-bounded order queries + bounded maintenance as volume grows. No business behaviour changes.

## Key decisions
- **Partition key = `created_at` (monthly RANGE)**. Postgres requires the partition column in every unique constraint / PK, so `orders` PK becomes composite **`(created_at, id)`** (created_at first so pruning + the common time-ordered scans benefit; `id` still unique in practice — it's a UUID). All existing UNIQUE/lookups on `orders` re-created to include `created_at` where needed; `id`-only lookups still work (a bare `WHERE id = ?` scans all partitions — acceptable, and the hot paths are tenant+time-scoped; document it).
- **`order_items` FK dropped** (KISS + lower risk): Postgres can't FK-reference a partitioned table's PK without also carrying the partition key, which would force `order_items` to denormalize `order_created_at` and partition too. Instead the FK `order_items.order_id → orders(id)` is dropped — the **Order aggregate is the integrity boundary** (items are only ever created/loaded WITH their order, never independently), and `orders` is never hard-DELETEd (terminal states, no cascade fires). The `order_id` column + its index stay for joins. Documented trade-off; `order_items` itself is NOT partitioned (small, always fetched by order_id).
- **Migration = create-copy-swap, reversible, data-preserving** (can't ALTER a populated table to partitioned in place):
  1. `CREATE TABLE orders_partitioned (LIKE orders INCLUDING DEFAULTS INCLUDING CONSTRAINTS EXCLUDING INDEXES)` re-declared as `PARTITION BY RANGE (created_at)` with PK `(created_at, id)` + the CHECKs/columns (incl. the 6a pricing + 6b restaurant_id columns).
  2. Create monthly partitions covering **[min(created_at) month … current+1 month]** from the live data, plus a `DEFAULT` partition as a safety net for any out-of-range row.
  3. `INSERT INTO orders_partitioned SELECT * FROM orders;` (preserve every column + row).
  4. Drop the `order_items→orders` FK; `ALTER TABLE orders RENAME TO orders_legacy; ALTER TABLE orders_partitioned RENAME TO orders;` re-create the non-PK indexes (tenant_id, status, etc.) on the new table. Keep `orders_legacy` for the migration's own rollback window (dropped in a follow-up or by `down()`), OR drop it at the end with `down()` recreating the plain table + copying back.
  5. `down()`: reverse — recreate the plain `orders`, copy rows back, restore the `order_items` FK.
- **Partition-maintenance job** (`@nestjs/schedule@6.1.3`): a monthly cron in the `order` service that `CREATE TABLE IF NOT EXISTS orders_pYYYYMM PARTITION OF orders FOR VALUES FROM (…) TO (…)` for **next month** (idempotent, runs safely on every boot + monthly). Retention (detach/drop partitions older than N months) is DOCUMENTED as the next step, implemented lightly or left as a noted follow-up (YAGNI at dev volume). Guarded off under `NODE_ENV=test`.
- **Repository unchanged**: TypeORM reads/writes `orders` transparently; partitioning is a pure storage concern. The ORM entity keeps `id` as the primary column but the DB PK is composite — verify TypeORM save/find still work (they operate on `id`; the composite PK is a superset). If TypeORM's insert needs the full PK, `created_at` is always set on create, so it's fine.

## Requirements
**Functional**: all existing order operations (place/reserve/confirm/cancel/get/list, the saga, idempotency) work unchanged over the partitioned table; existing rows preserved exactly; next-month partition auto-created. **Non-functional**: `EXPLAIN` shows **partition pruning** on a `created_at`-bounded query (only the relevant partition(s) scanned); the migration is reversible + loses no data; maintenance job idempotent.

## Architecture / data flow
```
orders  ──range-partition by created_at (monthly)──▶  orders_p2026_07, orders_p2026_08, …, DEFAULT
   PK (created_at, id)                                  (each a child partition, transparent to SQL)
order_items.order_id ──(FK dropped; app-enforced)──▶ orders   (join by order_id + index)

@nestjs/schedule monthly cron ─▶ CREATE PARTITION OF orders for next month (idempotent)
time-bounded query (WHERE created_at BETWEEN …) ─▶ planner prunes to the covering partition(s)
```

## Related code files
- `apps/order/src/infrastructure/persistence/migrations/<ts>-partition-orders-by-month.ts` — the create-copy-swap migration (up + reversible down); drops the order_items FK; recreates indexes; creates the initial partitions + DEFAULT.
- `apps/order/src/infrastructure/persistence/partitioning/orders-partition-maintenance.ts` (+ a `@nestjs/schedule` provider) — computes next month's range + `CREATE TABLE IF NOT EXISTS … PARTITION OF orders …`; runs on boot + monthly; NODE_ENV=test guard.
- `apps/order/src/app.module.ts` — `ScheduleModule.forRoot()` + provide the maintenance job.
- `apps/order/src/infrastructure/persistence/entities/*` — confirm the ORM entity/mapper still map cleanly (composite DB PK; `id` stays the entity id). Update `apps/order/src/testing/order-test-database.ts` (register the new migration) so the in-process testcontainers e2e runs it.
- `package.json` — add `@nestjs/schedule@6.1.3`.
- **Verify (a doc/test artifact)**: an EXPLAIN-pruning assertion — a gated e2e or a unit-ish check that a `created_at`-bounded query plan touches only the covering partition (via `EXPLAIN` over a testcontainers Postgres).

## Implementation steps
1. Add `@nestjs/schedule`. Design the partitioned DDL (PK `(created_at,id)`, monthly partitions, DEFAULT).
2. Write the create-copy-swap migration (reversible, data-preserving) + drop order_items FK + recreate indexes. Register it in `order-test-database.ts`.
3. Partition-maintenance job (next-month partition, idempotent, cron + on-boot) + ScheduleModule wiring.
4. Confirm all order unit + e2e still pass (repository transparent); add an EXPLAIN-pruning check.
5. Update plan before push; PR.

## Todo
- [ ] `@nestjs/schedule` added; partitioned DDL designed (PK `(created_at,id)`, monthly + DEFAULT)
- [ ] create-copy-swap migration (reversible, preserves rows) + order_items FK dropped + indexes recreated + registered in test DB
- [ ] partition-maintenance job (next-month, idempotent, cron+boot, test-guarded) + ScheduleModule
- [ ] all order unit + e2e green over the partitioned table (repository unchanged)
- [ ] EXPLAIN shows partition pruning on a created_at-bounded query (verified)
- [ ] biome/cruiser/knip/tsc; plan updated before push

## Success criteria
- The migration runs on the live order DB, preserves every existing order row, and `orders` is a monthly-range-partitioned table; a rollback (`down()`) restores the plain table + FK with no data loss.
- `EXPLAIN` on `SELECT … FROM orders WHERE created_at >= … AND created_at < …` prunes to only the covering partition(s).
- The maintenance job creates next month's partition idempotently; no order operation regresses (all saga/e2e green).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Partition migration data loss | L×H | create-copy-swap (never in-place); INSERT SELECT preserves rows; DEFAULT partition catches strays; reversible down(); verify count(*) pre/post |
| Composite PK breaks TypeORM save/find | M×M | `id` stays the entity id + always-set `created_at`; run the full order unit+e2e over the partitioned schema before merge |
| order_items integrity after FK drop | L×M | Order aggregate is the write boundary (items never created without their order); orders never hard-deleted; documented |
| Bare `WHERE id=?` scans all partitions | M×L | Hot paths are tenant+time-scoped; document; a global id index could be added later if needed |
| Missing future partition → insert fails | M×H | DEFAULT partition + on-boot + monthly maintenance job pre-creates next month |

## Security considerations
- No change to tenant/soft-delete filters — the repository base is unchanged; every partition inherits the same row-level filters.
- Partition-maintenance DDL runs with the app's DB role (dev); least-privilege + audited DDL is a P8 hardening note.
- No data exposure change — partitioning is a storage-layout concern only.

## Next steps
7b read replica + read/write router (route order-history reads to the replica; read-your-writes). 7c cache strategies. Retention (drop old partitions) + a global-id index if bare-id lookups grow. P8 monitors partition sizes + slow queries.
