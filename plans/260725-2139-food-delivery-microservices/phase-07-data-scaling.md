# Phase 7 — Data scaling (partition, replica, cache strategies)

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2
- **Status**: 🔄 In progress — **7a** [partition `orders` by month](./phase-07a-orders-partitioning.md) done (#26); **7b** [read replica + read/write routing](./phase-07b-read-replica-routing.md) in progress; **7c** cache strategies remaining.
- **Brief**: Now that real order volume exists, learn data-tier scaling: partition `orders` by time, add a read replica + read/write routing, and apply deliberate cache strategies (cache-aside, write-through, TTL, invalidation). No new business features — pure performance/scale learning.

## Key insights
- Partitioning is best learned on `order` (natural time dimension + growth). Declarative range partition by `created_at` (monthly). Teaches partition pruning + maintenance.
- Read replica + routing teaches read/write split. Route heavy reads (order history, analytics-ish) to replica; writes to primary. Watch replication lag on read-after-write.
- Cache strategy is a matrix, not one pattern: cache-aside for catalog reads, write-through for config, TTL for search-ish, explicit invalidation on events. Make the choice per case explicit.
- Sharding is introduced as a documented design (hash by tenant_id) but implemented lightly/optionally — YAGNI at current scale; explain when it'd be needed.

## Requirements
**Functional**: order queries work transparently over partitions; historical reads hit replica; caches serve hot reads with correct invalidation.
**Non-functional**: partition pruning verified via EXPLAIN; replica lag monitored + read-after-write consistency handled; cache hit ratio measured; no stale-after-write bugs.

## Architecture
- `orders` → declarative range partitions by `created_at` (per month) + automated future-partition creation (BullMQ/node-cron job).
- Postgres primary + streaming read replica (compose); app data-source router: writes→primary, tagged reads→replica; read-your-writes fallback to primary within a short window.
- Cache layer (Redis, already present): cache-aside for catalog reads, write-through for config, event-driven invalidation on catalog/config changes.

## Related code files (to create)
- Migrations: convert `orders`/`order_items` to partitioned tables; backfill/migration path
- `apps/order/*` — partition-aware queries; partition-maintenance scheduled job (BullMQ + node-cron)
- `libs/shared/persistence/*` — read/write data-source router, replica-lag/read-your-writes helper
- `libs/shared/cache/*` — cache-aside + write-through helpers, invalidation on events
- `infra/*` — Postgres primary+replica (streaming replication) in compose

## Implementation steps
1. Design partition scheme (monthly range on created_at); write migration to partitioned table with backfill; verify with EXPLAIN partition pruning.
2. Scheduled job auto-creates next month's partition + retention policy for old ones.
3. Add read replica (streaming replication) in compose; build data-source router (write=primary, read=replica) with read-your-writes safeguard.
4. Route order-history + heavy reads to replica; measure lag; handle read-after-write.
5. Implement cache strategies: catalog cache-aside, config write-through, event-driven invalidation; add hit-ratio metric.
6. Document sharding design (hash by tenant_id) + trigger conditions; optional thin PoC.
7. Load test (k6): confirm partition pruning + replica offload + cache hit ratio under load.

## Todo
- [ ] orders partitioned by month + backfill migration
- [ ] partition-maintenance scheduled job + retention
- [ ] read replica + read/write router + read-your-writes
- [ ] cache strategies (aside/write-through/invalidation) + hit-ratio metric
- [ ] sharding design documented (+ optional PoC)
- [ ] k6 load test validates pruning/offload/cache

## Success criteria
- EXPLAIN shows partition pruning on time-bounded order queries; new-month partition auto-created.
- Heavy reads hit replica (verified in logs/metrics); no read-after-write anomalies in tests.
- Cache hit ratio measurably improves hot-path latency; invalidation prevents stale reads after writes.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Partition migration data loss | L×H | Backfill on copy; dual-write/verify; reversible migration; backup first |
| Replica lag → stale reads | M×M | Read-your-writes to primary within window; monitor lag |
| Cache invalidation bugs (stale) | M×H | Event-driven invalidation + short TTL safety net; tests for write→read |
| Over-engineering sharding | M×L | Keep as documented design; PoC only, YAGNI now |

## Security considerations
- Replica read path still enforces tenant + soft-delete filters (same repository base).
- Cache keys tenant-namespaced to prevent cross-tenant cache poisoning/leak.
- Partition maintenance job runs with least privilege; audit partition DDL.

## Next steps
Feeds P8: partitions/replica/caches become things to monitor (metrics, slow-query, cache hit-ratio dashboards) and to reflect in K8s resource sizing/HPA.
