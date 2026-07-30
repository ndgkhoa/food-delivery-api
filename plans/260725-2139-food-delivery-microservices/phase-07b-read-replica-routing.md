# Slice 7b — Postgres read replica + read/write routing (order)

Context: [phase-07.md](./phase-07-data-scaling.md) · [phase-07a.md](./phase-07a-orders-partitioning.md) · [phase-02.md](./phase-02-order-core-inventory.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2 — second P7 slice (after 7a partitioning). 7c cache next.
- **Status**: ✅ Verified live (adversarial review in progress) — branch `feat/read-replica-routing`. `postgres-replica` streaming standby (pg_basebackup) + TypeORM `replication {master, slaves}` with `defaultMode: 'master'` (every existing read is master-safe by construction; only the new order-history `findRecentByTenant` opts into the slave). Live evidence: streaming replication confirmed (`pg_stat_replication` shows the standby `streaming async` at **0 lag**; replica has all **1334 orders**; replica **rejects writes** = read-only standby); replica e2e **3/3** (connected · read-your-writes visible IMMEDIATELY via master · lag-tolerant read served by the slave after catch-up); single-node testcontainers e2e (place-cancel **4/4**) still passes with no `DB_REPLICA_HOST` (slaves→master). order unit **81** + shared-persistence **10**; offline gates clean. **Infra note**: the replication-role/pg_hba init runs only on a FRESH primary volume — a pre-existing primary (like the running dev DB) needs the `replicator` role + pg_hba added manually (done live); PG18 PGDATA is `/var/lib/postgresql/18/docker`. - **Adversarial review + fixes applied** (report `reports/code-reviewer-260730-2351-slice-7b-read-replica-routing-red-team-review-report.md`; **NO Critical** — read-your-writes genuinely closed: `defaultMode:'master'` verified as a real TypeORM option, `findRecentByTenant` is the ONLY slave read, all write-path/outbox/saga/idempotency reads hit master, writes/DDL never touch the replica, single-node fallback bulletproof, no tenant/soft-delete/authz divergence):
  - **H1 (High)** — a replica outage 500'd `GET /orders` (TypeORM does NOT auto-fall-back for a slave-pinned runner; my plan's "falls back" claim was wrong). **Fixed**: `readFromSlave` now falls back to master on a connection-class error (SQLSTATE `08…` + `ECONN*`) → the history read degrades lag-free instead of failing; a genuine query error still surfaces (unit-tested).
  - **M1 (Medium)** — `DB_REPLICA_PORT` defaulted to 5432 (the primary), so setting only `DB_REPLICA_HOST` silently read from the primary. **Fixed**: default → 5433 (the compose host mapping).
  - **M2 (Medium)** — the history query had no `created_at`/index for the monthly partitions → full per-partition scan+sort. **Fixed**: composite `(tenant_id, user_id, created_at DESC)` index (migration; live-confirmed each partition uses `..._tenant_id_user_id_created_at_idx` via Index Scan).
  - **L1** stable ordering tiebreaker (`id` DESC) added. **L2** (fresh-volume-only replication provisioning — prod runbook step) + **L3** (`md5 all-host` replication + dev creds → P8) documented.
  - All re-verified: shared-persistence **11** unit (+1 H1 fallback), order **81**; replica e2e **3/3**; the index migration applied live + used. **Completes 7b.**
- **Brief**: Add a **streaming read replica** of the core Postgres and split the `order` service's traffic: writes → primary, heavy reads (order history/list) → replica, via TypeORM's built-in `replication: { master, slaves }`. Handle the two real hazards this introduces — **replication lag** and **read-your-writes** — so a client that just placed an order still sees it. No business behaviour change; the learning is read/write split + replica-lag handling.

## Key decisions
- **TypeORM native replication** (not a hand-rolled router): the order data-source becomes `replication: { master: {host: DB_HOST…}, slaves: [{host: DB_REPLICA_HOST…}] }`. TypeORM routes writes + transactions + explicit master reads to `master`, and non-transactional `SELECT`s to `slaves` automatically. `DB_REPLICA_HOST` **defaults to `DB_HOST`** when unset, so single-node dev (no replica) still works unchanged — the split only engages when a replica is configured.
- **Streaming replica infra**: the primary (`postgres:18.4`, already `wal_level=logical` + WAL senders/slots for Debezium) gains a physical replication role + a `postgres-replica` standby container that `pg_basebackup`s from the primary on first boot and streams. Under the `core` profile (or a `replica` profile). Dev creds; internal network only.
- **Read-your-writes safeguard**: replica lag means a read routed to the slave right after a write may miss it. The order service's own read-after-write paths (e.g. place-order returns the created order; the idempotency replay `loadExisting`; the saga reading its own just-written order) MUST read from **master** — either they already run in the write transaction (TypeORM pins master in a tx) or they explicitly force master. Only genuinely-lag-tolerant reads (list/history of OTHER/older orders) go to the slave. Document which reads are slave-eligible.
- **Which reads to the replica**: order **list/history** queries (`GET /orders` list, admin/history reads) — lag-tolerant, the heavy reads worth offloading. Keep the hot write-path reads (get-just-placed-order, saga self-reads, optimistic-lock reloads) on master. A read-your-writes helper documents the window; TypeORM transactions cover most of it for free.
- **`libs/shared/persistence`** (new/extended): a helper that builds the replication `DataSourceOptions` from `DB_*` + `DB_REPLICA_*` env (reused if other services adopt a replica later), and a small `readYourWrites`/force-master utility for the deliberate cases.
- **Verification**: with the replica up, a write lands on primary and a lag-tolerant read is served by the slave (proven via `pg_stat_replication` on the primary + a query hitting the replica); replication lag is observable; a place-order→immediately-get-order sees the order (read-your-writes holds); with NO replica (DB_REPLICA_HOST unset) everything still works.

## Requirements
**Functional**: all order operations work with the replica configured; heavy/lag-tolerant reads served from the replica; a just-written order is always visible to its writer (read-your-writes). **Non-functional**: writes never hit the replica; replication lag monitored (a lag query/metric); read-after-write consistency in tests; single-node dev (no replica) unaffected.

## Architecture / data flow
```
postgres (primary, wal_level=logical)  ──streaming replication──▶  postgres-replica (standby)
        ▲ writes + tx + read-your-writes reads            heavy/lag-tolerant reads ┘
order service data-source: replication { master: primary, slaves: [replica] }
   place/reserve/confirm/cancel/outbox/saga ─▶ master
   order list/history (lag-tolerant) ─▶ slave
   get-just-placed / idempotency replay / saga self-read ─▶ master (force / in-tx)
DB_REPLICA_HOST unset → slaves = [primary] (no split; dev single-node still works)
```

## Related code files
- `infra/docker-compose.yml` — `postgres-replica` streaming standby (init: create a replication user + slot on primary via an init script; the replica runs `pg_basebackup` + `standby.signal` + `primary_conninfo` on first boot). Primary: ensure `pg_hba`/`host replication` + a replication role. `.env.example` — `DB_REPLICA_HOST`/`DB_REPLICA_PORT`.
- `libs/shared/persistence/*` — `buildReplicatedDataSourceOptions(env)` (master + optional slaves from `DB_REPLICA_*`, defaulting slaves→master when unset) + a `forMaster`/read-your-writes helper. (If a `libs/shared/persistence` doesn't exist, create it; else extend.)
- `apps/order/src/infrastructure/persistence/typeorm-options.ts` — use the replicated options (master from DB_*, slave from DB_REPLICA_*). `config/order-env-schema.ts` — `DB_REPLICA_HOST` (default = DB_HOST), `DB_REPLICA_PORT` (default 5432).
- `apps/order/src/infrastructure/persistence/repositories/*` — mark the list/history read(s) slave-eligible (default TypeORM behaviour) and force master on the read-your-writes reads (get-just-placed order, `loadExisting`, saga self-reads). Add a `findMany`/history read that goes to the slave if not present.
- e2e: with a replica, assert a write is visible on the replica after lag + a lag-tolerant read is served by it; read-your-writes holds; a lag/`pg_stat_replication` check. Gate the replica-requiring parts.

## Implementation steps
1. Compose: replication role + slot on primary; `postgres-replica` standby (pg_basebackup + standby config) streaming from primary. Verify the replica catches up.
2. `libs/shared/persistence` replicated-datasource + read-your-writes helper.
3. Order data-source → replication {master, slaves}; env schema DB_REPLICA_*. Confirm single-node (no replica) still works (slaves→master default).
4. Route order list/history reads to slaves; force master on read-your-writes reads (in-tx or explicit).
5. **E2E**: read/write split proven (write→primary, lag-tolerant read→replica via pg_stat_replication); read-your-writes; lag observable.
6. Update plan before push; PR.

## Todo
- [ ] `postgres-replica` streaming standby in compose (replication role/slot on primary; pg_basebackup standby) + `.env.example` DB_REPLICA_*
- [ ] `libs/shared/persistence` replicated-datasource builder (slaves default→master) + read-your-writes/force-master helper
- [ ] order data-source uses replication {master, slaves}; env schema DB_REPLICA_*; single-node (no replica) still works
- [ ] order list/history reads → slave; read-your-writes reads (get-placed / loadExisting / saga self-read) forced → master
- [ ] E2E: write→primary + lag-tolerant read→replica (pg_stat_replication), read-your-writes holds, lag observable
- [ ] biome/cruiser/knip/tsc + unit tests; plan updated before push

## Success criteria
- With the replica up: a placed order is written to primary; a lag-tolerant list/history read is served by the replica (verified via `pg_stat_replication`/logs); a client that just placed an order always sees it (read-your-writes).
- Writes NEVER hit the replica; replication lag is observable (a lag query/metric).
- With `DB_REPLICA_HOST` unset (single-node dev), every order operation still works unchanged.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Replica lag → stale read after write | M×H | Read-your-writes reads forced to master (in-tx / explicit); only lag-tolerant reads to slave; documented per-read |
| Streaming-replication setup fragility (compose) | M×M | Official postgres pg_basebackup standby; primary already wal-ready; healthcheck waits for catch-up; fallback: slaves→master if replica down |
| Writes accidentally routed to replica | L×H | TypeORM sends writes/tx to master by construction; assert in an e2e |
| Single-node dev broken by replica config | M×M | DB_REPLICA_HOST defaults to DB_HOST → slaves=[primary]; no behaviour change without a replica |
| Replica down → reads fail | M×M | TypeORM falls back / document; health-gate; dev-only |

## Security considerations
- Replica enforces the SAME tenant + soft-delete filters (same repository/entities) — a read from the slave is as tenant-scoped as from master.
- Replication role is least-privilege (REPLICATION only), internal network; dev creds via env, real creds via secret provider (P8).
- No new data exposure — the replica is a physical copy behind the same app auth.

## Next steps
7c cache strategies (cache-aside/write-through/invalidation) — the replica + cache together offload the primary. P8 monitors replication lag + read/replica hit ratio; other read-heavy services (catalog, analytics-ish) can adopt the same replicated-datasource helper.
