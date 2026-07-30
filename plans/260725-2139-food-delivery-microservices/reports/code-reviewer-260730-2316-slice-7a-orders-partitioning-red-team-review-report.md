# Red-team review — slice 7a: `orders` monthly RANGE partitioning

Branch `feat/orders-partitioning`. Adversarial data-safety/reversibility review of the create-copy-swap migration + partition-maintenance job. up()/pruning/saga are live-verified (1334 rows preserved both directions) — attention on down(), index/CHECK completeness, composite-PK edges, DEFAULT/maintenance boundary logic. Read-only; no live runs.

## Verdict
No **Critical**. Migration is data-safe and reversible as verified. Two real robustness gaps in the **maintenance job** (not the migration): boot never ensures the current/missed month, and partition bounds are not pinned to UTC. Both are mitigated by the DEFAULT partition (no insert failure, no data loss) but cause silent pruning degradation + swallowed errors.

---

## SOLID (confirmed, do not re-open)

- **Index/CHECK/column preservation across the up() swap is complete.** Enumerated every object from all 3 prior migrations: PK on `id`, `idx_orders_tenant_id`, `idx_orders_tenant_user`, `chk_orders_total_cents_non_negative` (create) + the 4 pricing CHECKs (subtotal/delivery_fee/vat/discount) + all 13 columns incl. pricing breakdown and nullable `restaurant_id`. **No status/created_at/restaurant_id index ever existed.** up() re-creates all 13 columns, all 5 CHECKs (migration:54-58), composite PK `(created_at,id)` (line 59), and both non-PK indexes (line 160-163). Nothing silently dropped. The prompt's "most likely finding" (a dropped tenant/status index or CHECK) is **not present**.
- **down() faithfully restores the original schema.** id-only PK, all 13 columns, all 5 CHECKs (migration:169-190), both indexes (227-230), and the `order_items` FK re-added with Postgres's original auto-name `order_items_order_id_fkey` + `ON DELETE CASCADE` referencing `orders(id)` (234-238) — valid because the id-only PK is restored first. Copy-back is explicit-column (never `SELECT *`) with a row-count parity RAISE before any destructive rename/drop (202-215). `DROP TABLE ... CASCADE` on the partitioned parent (224) drops only its own partitions — the order_items FK was already dropped in up() and isn't re-added until down step 6, so CASCADE has no extra dependents.
- **Transactionality / atomic rollback holds.** All statements are transaction-safe DDL (no `CREATE INDEX CONCURRENTLY`, no `VACUUM`); the parity guard (up 115-128) RAISEs and rolls back *before* the original table is renamed/dropped (156-158). Any mid-migration failure leaves the untouched original `orders`. Live-verified both directions.
- **FK-drop integrity is safe.** Grep of `apps/order/src` finds **zero** hard-DELETE / `.remove()` / TRUNCATE of `orders` — orders only reach terminal states, so `ON DELETE CASCADE` never needed to fire. `order_items` rows are only ever inserted together with their order in `TypeOrmOrderRepository.insert` (repositories/typeorm-order.repository.ts:44-49). No orphan path.
- **Composite-PK correctness.** `id` is an app-generated UUID; no path inserts the same id with a different `created_at` (idempotency table blocks duplicate claims), so two rows sharing an id cannot exist. `findById` / `updateStatus` optimistic-lock / saga `transition` all filter by `id`+`tenant_id` (no `created_at`) and correctly target exactly one row via a cross-partition scan on the tenant index — live-verified (place-cancel 4/4).
- **Insert can never fail with "no partition found":** `created_at` is `NOT NULL` with `DEFAULT now()`, and the `orders_default` partition (migration:97-99) catches any out-of-range row. Month-boundary rows route correctly (RANGE upper bound exclusive).

---

## Findings

### [Medium] Boot ensures only NEXT month — current/missed month silently degrades to DEFAULT
`orders-partition-maintenance.ts:70,83` — `onApplicationBootstrap()` calls `ensureNextMonthPartition()` only; there is no "ensure current month" and no back-fill of a skipped month. `computeNextMonthPartitionRange` always returns `now()+1 month`.

Scenario A (outage across a cron tick): service down for all of August ⇒ the `0 0 1 * *` cron that would create September never fires. On recovery in September, boot creates *October*. **September has no partition** ⇒ September orders land in `orders_default`.
Scenario B (late first deploy): migration ran July (up() pre-creates only Jul + Aug — `date_trunc(now)+2 months`, migration:77). App first boots in October ⇒ boot creates November. **September and October have no partition** ⇒ their rows fall to DEFAULT.

Impact: no insert failure, no data loss (DEFAULT catches), but (1) partition pruning is lost for that month; (2) the code comment "a missed cron tick is self-healed by the next deploy" (lines 47-50) is **false** — boot never creates the skipped month; (3) once DEFAULT holds rows for month M, a later `CREATE ... PARTITION OF ... FOR VALUES` covering M **fails** with "default partition would be violated" and is swallowed (95-99), so M can never get its own partition without manual DEFAULT detach/re-insert.

Fix: on boot and cron, ensure every month from the latest existing partition through next month (loop), or at minimum create BOTH current and next month. A retention/back-fill routine that detaches DEFAULT, creates the missing month, and re-inserts would fully self-heal.

### [Low-Medium] Partition bounds not pinned to UTC; up() and the job derive them differently
up() computes bounds server-side via `date_trunc('month', ...)` / `+ interval '1 month'` (migration:76-88). The job computes `YYYY-MM-DD` strings in Node **UTC** (`orders-partition-maintenance.ts:22-33`) and interpolates them into `FOR VALUES FROM ('2026-09-01') TO ('2026-10-01')` (line 92), where Postgres casts each date literal to `timestamptz` **in the session `TimeZone` GUC**. No timezone is pinned on the datasource (`typeorm-options.ts:34-47` sets none).

As long as the CLI migration and the running service inherit the **same** server TimeZone, adjacent partitions stay contiguous — latent. But if the migration shell and the service run under different session TZ (e.g. `PGTZ`/`-c timezone=` differs), the two partition sets misalign at month boundaries: a **gap** ⇒ boundary rows silently fall to DEFAULT, or an **overlap** ⇒ the job's `CREATE` fails and is swallowed (95). Boundaries also sit at local-midnight, not UTC-midnight.

Fix: pin the connection to UTC (`extra: { options: '-c timezone=UTC' }` or `SET TIME ZONE 'UTC'`) and/or cast bounds explicitly (`'2026-09-01 00:00:00+00'::timestamptz`) so up() and the job agree independent of GUC.

### [Low] Maintenance DDL failures are swallowed with only a log — no metric/alert
`orders-partition-maintenance.ts:95-99` catches every error (correct: boot must not crash). But the only signal is `logger.error`. Combined with the two findings above, a permanently-failing partition creation (overlap-with-DEFAULT) degrades to DEFAULT-only **silently**. Add a metric/health signal on repeated failure so ops notices before pruning is lost at scale.

---

## Unresolved questions
- Is the production Postgres `TimeZone` GUC guaranteed UTC, and is the migration always run from a shell inheriting that same GUC? If yes, the Low-Medium TZ finding stays latent; if the CLI/app can diverge, raise it to Medium.
- Retention (detach/drop old partitions) is deferred (documented). Out of scope for 7a but note: without it, the number of child partitions grows unbounded, which the swallowed-error path (finding 3) would hide.
