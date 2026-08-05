# Slice 7c Cache Strategies — Adversarial (Red-Team) Review

Branch `feat/cache-strategies`. Read-only review. Happy-path (miss/hit/write-through/evict/tenant/redis-down) is live-verified per task; this focuses on races, list staleness, corrupt-entry, projector-never-throw.

**Verdict:** No Critical defects. One High (stale-set race, 60s window, contradicts the "never stale-after-write" claim). Rest Medium/Low. Core design is sound.

---

## Critical
None. Every stale path is bounded by TTL (60s restaurant / 5s list) and self-heals on the next event or expiry. No cross-tenant leak, no poison-500, no dead-letter of a good event.

---

## High

### H1 — Cache-aside SET has no version guard → stale entry for up to 60s after a write (lost update race)
`redis-cache.ts:40-51` (cacheAside) + `:54-62` (writeThrough, unconditional `SET ... PX`) + `catalog-cache-sync.ts:45-47`.

`writeThrough` is an unconditional `redis.set`. `cacheAside` always `writeThrough`s the loader result. There is no CAS / WATCH / SET-if-newer / version compare. Concrete interleaving:

1. Reader misses, loader reads read-model row `V0` (before the projector commits).
2. Projector commits `V1`, `syncRestaurantCache` re-reads `V1`, `writeThrough` `SET V1`.
3. Reader's `writeThrough` `SET V0` lands **after** step 2.
4. Cache now holds stale `V0`. Every `GET /restaurants/:id` returns `V0` until the 60s TTL expires (or the next `catalog.events`/`review.events` for that aggregate re-warms it).

The e2e passed because miss→write→read was sequential, not concurrent. Under real concurrent read+edit traffic this reintroduces exactly the stale-after-write the slice claims to close. The docstrings (`get-restaurant-view.handler.ts:17-27`, `catalog-cache-sync.ts:13-25`) and spec (`phase-07c` line 13 "never serving the pre-change value", risk table "no stale-after-write") overstate the guarantee.

**Two amplifiers of the same root cause:**
- **Two concurrent projector consumers** (`CatalogProjectionConsumer` + `ReviewProjectionConsumer`, separate groups, `:81` / `:70`) both `writeThrough` the *same* key. A near-simultaneous edit + rating-change: whichever re-read the older row `SET`s last wins → momentary stale field for 60s.
- **Delete-repopulate:** reader loads live row `V0`, delete commits + `invalidate` (DEL), reader's `SET V0` lands after the DEL → a deleted restaurant served from `get-restaurant-view` for up to 60s.

**Severity:** High not Critical because it self-heals within 60s and on any subsequent event. But the window is real and the "no stale-after-write" claim is inaccurate as written.

**Fix options (pick one):**
- Make it a *documented, accepted* bounded window: soften the docstrings/spec from "never stale" to "stale ≤ TTL under a read/write race; self-heals on next event or expiry", and drop the TTL (e.g. 5-10s) to shrink the window. Cheapest, KISS, no new machinery.
- Or add a version guard on write-through: cache `{version, snapshot}`, and `writeThrough` via a Lua `SET`-if-`version`-newer. Caveat: `updateRating` (`typeorm-read-restaurant.repository.ts:72-79`) does **not** bump `updated_at`, so `updatedAt` cannot serve as the version for rating events — you'd need a dedicated monotonic version column or per-key event sequence. Higher cost; likely YAGNI at this scale — prefer option 1 unless a hard freshness SLA exists.

---

## Medium

### M1 — `syncRestaurantCache` re-read is on the consumer's throw path (docstring claims never-throw)
`catalog-cache-sync.ts:45` `readRestaurants.findById(...)` is unguarded. It runs **after** the transaction commits (`catalog-projection.consumer.ts:81`, `review-projection.consumer.ts:70`). If that read-model read throws (transient Postgres blip in the window between commit and re-read), `syncRestaurantCache` throws → the message handler throws → Kafka offset not committed → redelivery.

Not a data-corruption bug: projection is idempotent (`processed_events` dedupe skips re-apply) and re-warm is idempotent, so this is normal at-least-once retry. **But**: (a) it contradicts the function's own docstring intent that cache warming is optional/never-throw, and (b) with a DLQ-after-N-retries policy a *successfully-projected* event could be dead-lettered on a persistent read-model outage. Note the cache SET/DEL themselves never throw (caught) — only the re-read.

**Fix:** wrap the re-read + write-through in try/catch → log + skip warm (next read re-loads). Makes `syncRestaurantCache` genuinely never-throw and matches its docstring, so a read-model hiccup can never park a committed event.

---

## Low / Informational

### L1 — `/internal/cache-stats` open to any authenticated tenant
`cache-stats.controller.ts` + `app.module.ts:103` (only `RolesGuard`; comment "reads stay open to any authenticated tenant"). Payload is process-wide counts only (`{hits,misses,hitRatio}`) — **no tenant data, no PII, no leak**. Acceptable. Only flag: if `/internal/*` is reachable directly (bypassing the gateway) it's unauthenticated; confirm network boundary keeps `internal/*` off the public gateway route in P8.

### L2 — `CacheModule.forRoot` bypasses the validated env value
`app.module.ts:56` reads `process.env.REDIS_URL ?? 'redis://localhost:6379'` directly instead of the zod-validated `ConfigService` value (`catalog-env-schema.ts:20`). Harmless today (same default, no transform), but if the schema ever normalizes/validates the URL the module won't see it. Prefer sourcing from `ConfigService`.

### L3 — Schema-drift across deploys can produce Invalid Date, not a 500-loop
`restaurant-cache-snapshot.ts:36-49` `fromRestaurantCacheSnapshot` → `new Date(undefined)` = Invalid Date (no throw); `Restaurant.reconstitute` = `new Restaurant(props)` with no validation (`restaurant.ts:70-72`). So an old-shape cached snapshot after a deploy rehydrates to a restaurant with an Invalid Date field (serializes to `null`) rather than 500-ing every read. TTL-bounded, cosmetic. If a field is ever renamed/removed, consider a cache key/version bump to avoid serving degraded entries for one TTL.

---

## Confirmed SOLID (verified, not re-litigating live results)

- **Write-through re-reads the committed row, not the event payload** — `catalog-cache-sync.ts:45` `findById` runs post-commit outside any tx (`getTransactionalEntityManager()` returns undefined → non-transactional repo → latest committed), so rating/name partial-payload gaps are avoided (`:20-23` docstring accurate). Row-gone → `invalidate` (`:48-51`), no stale hit left behind.
- **Post-commit sync ordering** — sync is outside `runInTransaction`, so a rolled-back value can never warm the cache.
- **Corrupt-entry never poisons** — `safeGet` (`redis-cache.ts:92-102`) wraps `JSON.parse` in try/catch → returns undefined → miss → loader. No 500-loop. Rehydration has no throw path (see L3).
- **Tenant isolation complete** — every key includes tenantId (`cache-keys.ts:15-24`); loaders are tenant-scoped (`findById(id, tenantId)`, `findAndCount(tenantId, …)`); cross-tenant collision structurally impossible. cache-stats leaks no tenant data.
- **List key includes all query params** — `Pagination` is only `{page, limit}` (`pagination.ts:1-4`); no filter/search params exist, so no filtered-query collision on one entry. List staleness is a bounded 5s TTL window; read model hard-deletes (`typeorm-read-restaurant.repository.ts:67-69`) so a deleted row drops from the next list load. Deleted-in-list→404-on-click window ≤ 5s, documented (`cache-keys.ts:34-44`).
- **Redis-down does NOT break the projector** — the #6 guarantee holds: on a Redis outage `syncRestaurantCache`'s `findById` (Postgres, healthy) succeeds and `writeThrough` catches the Redis error (`redis-cache.ts:57-61`) → no throw → offset commits. Fast-fail config (`cache.module.ts:49-53`: `enableOfflineQueue:false`, `commandTimeout:200`, `maxRetriesPerRequest:1`) + `error` listener (`:57`) bound a down-Redis read to ~200ms and prevent an unhandled-error crash.
- **GetRestaurantHandler correctly uncached** — `get-restaurant.handler.ts` stays on the write model for strongly-consistent parent-existence checks inside command transactions; caching it could pass a stale existence check. Correct. No other read is mis-cached (list + view are the eventually-consistent read-model paths; both cached appropriately).
- **Negative caching** — a not-found id caches `null` for 60s; a subsequent `RestaurantCreated` write-throughs the real snapshot (subject to H1's race like any other write).

---

## Unresolved questions
1. Is a ≤60s stale-read window on a concurrent restaurant edit an accepted SLA? If yes → soften the "never stale" wording (H1 option 1) + consider a shorter restaurant TTL. If no → version-guarded write-through (H1 option 2), and add a monotonic version since `updated_at` isn't bumped on rating changes.
2. Is `/internal/*` guaranteed off the public gateway route? (L1)

**Status:** DONE
**Summary:** No Critical/no cross-tenant leak/no poison-500/no good-event dead-letter. One High: unconditional write-through `SET` with no version guard reintroduces a ≤60s stale-after-write window under a read/edit race (amplified by two concurrent projector consumers and delete-repopulate), contradicting the "never stale" claim — fix by softening the guarantee + shorter TTL, or version-guarded SET. One Medium: `syncRestaurantCache`'s post-commit re-read is unguarded and can reprocess/DLQ a committed event on a DB blip — wrap it to be truly never-throw. Write-through-reads-committed-row, tenant isolation, corrupt-entry fallback, Redis-down non-blocking, and uncached-write-handler are all SOLID.
