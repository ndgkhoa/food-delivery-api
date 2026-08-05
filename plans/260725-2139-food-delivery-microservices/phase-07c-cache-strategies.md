# Slice 7c — Cache strategies (cache-aside + write-through + invalidation)

Context: [phase-07.md](./phase-07-data-scaling.md) · [phase-03b.md](./phase-03b-catalog-outbox-cqrs.md) · [phase-06a.md](./phase-06a-config-service-and-client.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2 — third/last P7 slice (after 7a partitioning #26, 7b replica #27). Completes P7.
- **Status**: ✅ Verified live (adversarial review in progress) — branch `feat/cache-strategies`. `libs/shared/cache` (cache-aside + write-through + invalidation, tenant-namespaced, never-throw with fast-fail Redis config) applied to catalog restaurant reads (cache-aside on get-view/list) + the read-model projector (write-through on create/update/rating-change, evict on delete). Live evidence: cache-e2e **4/4** (miss→hit via `/internal/cache-stats` · write-through: update → next read returns the NEW value, no stale · delete→evict · tenant isolation) + Redis-down scenario **passed** (reads fall back to DB — never a hard dependency); the hit-ratio metric works (hits/misses counted); the tenant-namespaced key `catalog:restaurant:{tenant}:{id}` confirmed in Redis. catalog **61** + shared-cache **12** unit; offline gates clean. `GetRestaurantHandler` (write-model, used in write-tx consistency checks) deliberately uncached.
- **Adversarial review + fixes applied** (report `../reports/code-reviewer-260731-0747-slice-7c-cache-strategies-red-team-review-report.md`; **NO Critical** — write-through re-reads the committed row, tenant isolation complete, corrupt-JSON falls back to loader (no poison-500), Redis-down non-blocking + doesn't break the projector, uncached write-handler correct, all SOLID):
  - **H1 (High)** — cache-aside `SET` has no version guard, so a read-miss whose write-back lands AFTER a concurrent write-through/delete leaves a stale value until the TTL; the "never stale" wording overstated it. **Fixed**: honest bounded-eventual-consistency framing in the code/plan + the restaurant TTL tightened (60s→**30s**) as a shorter self-healing backstop (a version-guarded write is the alternative, but the rating update bumps no version to compare — documented).
  - **M1 (Medium)** — the projector's post-commit cache re-read was unguarded, so a transient read-model error could dead-letter an ALREADY-committed projection. **Fixed**: `syncRestaurantCache` is now never-throw (best-effort warm; the next read re-loads) — unit-tested.
  - Deferred (documented): L1 (`/internal/cache-stats` — not a gateway route, counts only, no PII), L2 (`CacheModule.forRoot` reads `process.env` not the zod value), L3 (snapshot schema-drift → cache-key version bump on field renames).
  - All re-verified: catalog **62** unit (+1 M1 test) + shared-cache **12**; cache-e2e live evidence above stands. **Completes P7.**
- **Brief**: Add a Redis cache layer to `catalog`'s hot restaurant reads and demonstrate the **cache-strategy matrix** on the SAME data: **cache-aside** on the reads (miss → load read-model → cache) and **write-through** on the read-model projector (a `catalog.events` change updates the read model AND the cache, so the next read is warm), with **event-driven invalidation** (delete → evict) and a **hit-ratio metric**. Config already embodies the read-through+event-evict variant (6a config-client) — 7c documents where each pattern fits. No business behaviour change; the learning is the deliberate per-case cache strategy + correct invalidation (no stale-after-write).

## Key decisions
- **A new `libs/shared/cache`** (Redis via the existing `ioredis@^5.11.1`, on the `core` Redis): `cacheAside<T>(key, ttlMs, loader)` (get → hit returns; miss → loader() → set with TTL → return), `writeThrough<T>(key, value, ttlMs)` (set the cache to a freshly-known value), `invalidate(key)` / `invalidatePattern`, and a **hit/miss counter** feeding a hit-ratio (exposed via a tiny read-only endpoint or logged). Keys are **tenant-namespaced** (`catalog:restaurant:{tenantId}:{id}`) so no cross-tenant cache poisoning. JSON-serialised values; short TTL as a staleness backstop even if an invalidation is missed.
- **cache-aside on catalog reads**: `get-restaurant-view` / `get-restaurant` / `list-restaurants` read-model queries wrap in `cacheAside` — a miss loads the read-model row(s) and caches them; a hit skips Postgres. List caching keyed by the query (tenant + pagination) with a short TTL (lists change often; per-restaurant entries are the main win).
- **write-through on the read-model projector**: the `catalog.events` projector (which already updates the read model on `RestaurantCreated`/`RestaurantUpdated`, and the 6b `review.events` rating projector) additionally **writes the new value through to the cache** (or evicts) so a read right after a change is warm/correct — never serving the pre-change value. `RestaurantDeleted` → **invalidate** (evict). This closes stale-after-write: the cache is updated in lock-step with the read model it fronts.
- **Tenant + soft-delete correctness**: cached values carry the same tenant scope as the DB read; an inactive/deleted restaurant is evicted, never served from cache. Cache key includes tenantId; a cross-tenant read can't hit another tenant's entry.
- **Hit-ratio metric**: an in-process hit/miss counter per cache, exposed on a small `GET /internal/cache-stats` (or logged periodically) so the offload is measurable — the phase's "cache hit ratio measured" success criterion.
- **Sharding** (phase-level item): DOCUMENTED design only — hash-by-`tenant_id` sharding of the order/analytics data, with the trigger conditions (when a single primary + replica + cache no longer suffice) — a design note in this plan / phase-07, NOT implemented (YAGNI at current scale). **k6 load test** (phase-level item): deferred/noted — the pruning (7a) + replica offload (7b) + cache hit-ratio (7c) are each verified functionally; a combined k6 load run is a follow-up, not a blocker.
- **Redis unavailable ≠ hard dependency**: a cache get/set failure falls back to the loader (DB read) — the cache is an optimisation, never required for correctness (mirrors config-client's never-throw stance).

## Requirements
**Functional**: catalog restaurant reads served from Redis on a hit; a `catalog.events`/`review.events` change updates (write-through) or evicts the cached entry so no stale read after a write; a delete evicts. **Non-functional**: cache hit-ratio measurable; tenant-namespaced keys (no cross-tenant leak); short TTL backstop; Redis down → transparent fallback to DB (never a hard dependency); no stale-after-write in tests.

## Architecture / data flow
```
GET /restaurants/:id ─▶ cacheAside("catalog:restaurant:{tenant}:{id}", ttl, () => readModel.findById)
        hit → Redis;  miss → read-model (Postgres) → set Redis → return   [+ hit/miss counter]
catalog.events (RestaurantUpdated) / review.events (RatingChanged) ─▶ projector
        └─ update read model  +  writeThrough(cacheKey, newValue)   (warm, never stale)
catalog.events (RestaurantDeleted) ─▶ projector ─ update read model + invalidate(cacheKey)
Redis get/set error ─▶ fall back to the loader (DB) — cache never blocks a read
GET /internal/cache-stats ─▶ { hits, misses, hitRatio }
```

## Related code files
- `libs/shared/cache/*` — new lib (scope tag + tsconfig alias): `redis-cache.ts` (`cacheAside`/`writeThrough`/`invalidate`, tenant-namespaced keys, JSON, never-throw fallback), `cache-metrics.ts` (hit/miss counter + ratio), `cache.module.ts` (Nest module, ioredis client from `REDIS_URL`). Register the lib (alias, tags, knip).
- `apps/catalog/*` — env `REDIS_URL`; wrap `get-restaurant-view`/`get-restaurant`/`list-restaurants` handlers in `cacheAside`; the read-model projector (`catalog-read-model-projector.ts` + the rating projector) `writeThrough`/`invalidate` on change; a `cache-stats` read-only endpoint (or periodic log). `catalog` gains the cache module.
- `infra/*` — `.env.example` catalog `REDIS_URL` (Redis already in `core`). No new infra.
- e2e/tests: a read populates the cache (2nd read is a hit, no DB hit — assert via the metric or a spy); a `RestaurantUpdated` makes the next read return the NEW value (write-through, no stale); a delete evicts; tenant isolation (tenant A's cache never served to B); Redis-down falls back to DB.

## Implementation steps
1. `libs/shared/cache` (cacheAside/writeThrough/invalidate, tenant keys, metrics, never-throw) + module + register the lib.
2. Catalog: REDIS_URL env + cache module; wrap the 3 read handlers in cacheAside.
3. Projector: writeThrough on RestaurantCreated/Updated + rating change; invalidate on RestaurantDeleted.
4. Hit-ratio metric endpoint/log.
5. Tests: cache hit skips DB; write-through no-stale; delete evicts; tenant isolation; Redis-down fallback.
6. Sharding design note (phase-07) + k6 deferred note. Update plan before push; PR.

## Todo
- [x] `libs/shared/cache` (cacheAside/writeThrough/invalidate, tenant-namespaced, metrics, never-throw fallback) + module + registered
- [x] catalog reads (get-view/list) cache-aside via Redis + REDIS_URL env — `GetRestaurantHandler` (write-model, used only for strongly-consistent parent-existence checks inside command transactions) deliberately left uncached; see handler doc comment
- [x] read-model projector write-through on create/update/rating-change; invalidate on delete
- [x] hit-ratio metric (`GET /api/v1/internal/cache-stats`)
- [x] tests: hit skips DB, write-through no-stale, delete evicts, tenant isolation, Redis-down fallback (unit + gated e2e; e2e not executed by this agent)
- [x] sharding design documented + k6 noted as follow-up (already captured in this file's Key decisions)
- [x] biome/cruiser/knip/tsc — all green; plan updated before push

## Success criteria
- A repeated restaurant read is served from Redis (measurable hit-ratio); a restaurant update makes the very next read return the new value (write-through, no stale); a delete evicts.
- Cache keys tenant-namespaced — one tenant never sees another's cached restaurant.
- Redis down → reads transparently fall back to Postgres (cache is never a hard dependency).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Stale read after write | M×H | Write-through in the SAME projector that updates the read model + short TTL backstop + evict-on-delete; tests for write→read |
| Cross-tenant cache poisoning | L×H | Keys namespaced by tenantId; a read can only hit its own tenant's entry; tested |
| Redis down breaks reads | M×M | Never-throw: get/set failure falls back to the loader (DB); cache is an optimisation |
| List cache churn/staleness | M×L | Short TTL on list keys; per-restaurant entries are the primary win; document |
| Cache/read-model divergence | M×M | Cache updated in lock-step with the read model (same projector) — no independent path |

## Security considerations
- Tenant-namespaced keys prevent cross-tenant reads/poisoning; cached values are as tenant-scoped as the DB read.
- No secrets cached; only public restaurant read-model fields. Redis internal-network only; dev creds via env, real creds via secret provider (P8).
- An inactive/deleted restaurant is evicted, never served stale from cache.

## Next steps
Completes P7. P8 wires cache hit-ratio + replica lag + partition sizes into observability dashboards; a k6 load run validates pruning + replica offload + cache hit-ratio together; sharding implemented if/when volume crosses the documented trigger.
