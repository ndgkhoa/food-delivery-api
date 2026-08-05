# Slice 4a — Search (Elasticsearch) — Red-Team Code Review

Branch `feat/search-elasticsearch`. Scope: `apps/search/`, gateway `search-proxy.controller.ts`, compose `elasticsearch`, `apps/search-e2e/`. Runtime already proven green; this pass hunts correctness/security bugs the happy-path e2e does not exercise.

**Verdict:** No cross-tenant leak and no silent-drop on the *proven* paths. One High (unbounded pagination → 5xx + spec violation), two Medium (bootstrap create race; same-ms version drop). Rest Low/informational.

---

## Critical
None. Tenant isolation holds on every query path (see Verified).

---

## High

### H1 — `page` is unbounded → deep pagination throws a 5xx (and violates the spec's pagination-cap requirement)
`apps/search/src/interface/http/dto/search-restaurants.request.ts:22-23` — `page` has `@Min(1)` but **no `@Max`**. `limit` is capped at 100.
`restaurant-search-query-builder.ts:21` computes `from = (page-1)*limit`. The index uses the default `index.max_result_window = 10000` (no override in `restaurant-index-definition.ts`).
`elasticsearch-restaurant-search.repository.ts:102-108` catches **only 404**; any other ES error rethrows → gateway relays a 5xx.

Scenario: `GET /api/v1/search/restaurants?q=pho&page=101&limit=100` → `from=10000, size=100` → `from+size=10100 > 10000` → ES `search_phase_execution_exception` → rethrown → 500 to the client. Also a cheap DoS lever (deep windows are expensive) and a direct violation of the spec's NFR (phase-04a line 85: "pagination caps to avoid expensive queries").

Fix: cap `page` (e.g. `@Max` so `from+limit ≤ 10000`), or reject/clamp when `from+size` would exceed the window in the handler, or move to `search_after` for deep paging. Minimum: bound it and return an empty/last page instead of a 500.

---

## Medium

### M1 — Index bootstrap has a TOCTOU race → concurrent first-boot of >1 replica crashes the loser
`restaurant-index-bootstrap.ts:43-54` does `indices.exists()` then `indices.create()` with **no catch**. Two search replicas booting against a fresh cluster both see "not exists", both call `create()`; the loser gets `400 resource_already_exists_exception`, which propagates out of `onApplicationBootstrap()` → the app fails to start (crash-loops until the index exists, then self-heals on restart).

Single-replica dev (the proven-green setup) never hits this; multi-replica prod rollout does. Fix: wrap `create()` and swallow `resource_already_exists_exception` (400) as success — the create-if-absent is only truly idempotent once the concurrent-create case is tolerated.

### M2 — Same-millisecond events → external-version guard silently drops the newer one (flagged prime suspect — real but low-likelihood)
`apply-restaurant-search-event.ts:33` sets `version = Date.parse(occurredAt)` (epoch **ms**). ES external versioning requires *strictly greater*; an equal version returns 409, which `elasticsearch-restaurant-search.repository.ts:70-72` treats as a safe no-op.

That swallow is correct for the intended case (Kafka redelivers the *same* event → equal version → no-op). But it also silently drops a **different, newer** event that happens to share the same `occurredAt` millisecond for the same aggregate (e.g. two rapid `RestaurantUpdated`, or a Created+Updated within 1 ms). Result: a stale doc with no error, no log, no DLQ — invisible.

Real-world likelihood is low: it needs two writes to the *same* restaurant inside one millisecond, and `occurredAt` originates from the catalog outbox `created_at`. But the failure mode is silent staleness, so the coarse ms resolution is a latent correctness hazard, not just theory.

Fix options: (a) use a strictly-monotonic per-aggregate version instead of a ms timestamp — the Kafka **offset** is already monotonic per partition and, since key=restaurantId → one partition, monotonic per aggregate; `DecodedKafkaMessage.offset` is available but the consumer currently passes only `{envelope,payload}` to `applyRestaurantSearchEvent`. (b) If keeping ms timestamps, document the same-ms limitation explicitly. Given per-aggregate ordering the drop is rare, but offset-as-version removes the hazard entirely.

---

## Low / Informational

- **L1 — Inactive restaurants are searchable.** Neither `buildRestaurantSearchBody` nor `buildRestaurantAutocompleteBody` filters `isActive`, so `isActive=false` docs appear in results/suggestions. Same-tenant only (no leak). Confirm intent: if diners must not see deactivated restaurants, add `filter: {term:{isActive:true}}` (but an admin surface may want all). Not blocking.
- **L2 — Fresh-index backfill gap (documented, accepted to P6).** Consumer subscribes with `fromBeginning` defaulting to `false` (`kafka-consumer.ts:150`), so a newly created `restaurants` index misses all pre-existing catalog restaurants until each is next updated. Spec phase-04a line 77 defers full reindex-from-read-model to P6 — accepted, but operationally load-bearing: after deploying search onto an existing catalog, existing restaurants are invisible to search until touched or a manual reindex runs. Flag in deploy runbook.
- **L3 — Resurrection protection is bounded by `gc_deletes` (60s default).** The external-version guard prevents a stale event from resurrecting a deleted doc only within ES's tombstone-retention window. Not real given per-aggregate ordering + delete-is-terminal, but note it.
- **L4 — `remove(id, _tenantId, version)` deletes by `_id` only, tenant param unused.** Safe: `_id` = aggregateId is a globally-unique UUID, so no cross-tenant collision is possible; a tenant's delete event only ever carries its own aggregateId. Cosmetic — could drop the unused param or add a defensive tenant match.
- **L5 — ES security disabled + 9200 published to host (dev-only).** `docker-compose.yml:206,209` `xpack.security.enabled: false` and `9200:9200`. Documented dev posture (TLS/auth = P8). Confirmed not exposed via Nginx. Fine for dev; ensure prod flips it.
- **L6 — `ELASTICSEARCH_NODE`/`KAFKA_BROKERS` have localhost defaults** (`search-env-schema.ts:16,18`) rather than fail-closed — a prod env missing them silently points at localhost. Consistent with the repo's existing convention across services, so not a slice regression; noting for env-hardening.
- **L7 — Malformed `occurredAt` → `version = NaN`.** `decodeHeaders` guarantees non-empty but not date-valid; a bad value yields NaN → ES 400 → retried → DLQ (not silent). Catalog controls the ISO format, so low risk; the DLQ path makes it visible.

---

## Verified correct

- **Tenant isolation (the security-critical path) is sound.** Tenant is read from `TrustedIdentityInterceptor` (`libs/shared/tenancy/.../trusted-identity.interceptor.ts`), which validates a UUID `x-tenant-id` and fails **closed with 401** when absent/malformed — never a raw client value. The gateway `HttpForwarder` builds the outbound header set from scratch, drops the client's `Authorization` and any spoofed identity headers, and stamps only the verified identity (`applyTrustedIdentityHeaders`). Both handlers call `getTenantIdOrThrow()` and pass `tenantId` down; **both** query builders unconditionally add `filter: [{ term: { tenantId } }]` (a `filter`, not `should`), and `tenantId` is mapped as `keyword` (exact term). No code path (empty result, autocomplete, 404-fallback) omits the tenant term.
- **Search proxy is authenticated.** Global `JwtAuthGuard` + `RateLimitGuard` in gateway `app.module.ts`; `SearchProxyController` relays read-only, no writes.
- **`function_score` scoring is safe for unrated docs.** `field_value_factor` on `rating` with `modifier: ln1p, missing: 0` → `ln1p(0)=0`; `boost_mode: sum` → text_score + 0, so rating 0 never zeroes the text relevance. Since all current docs have `rating:0`, ranking is pure text relevance (as intended until review data lands).
- **Autocomplete analyzer split is correct.** `name.autocomplete` indexes edge-ngrams (`vn_autocomplete_index`) but searches with `vn_autocomplete_search` (no ngram) → a typed prefix matches stored prefixes without ngram-exploding the query (no over-broad matches).
- **Idempotent versioning on the intended path.** Redelivered *same* event → equal external version → 409 → swallowed no-op (upsert). `remove` swallows 404+409 (both terminal). Non-conflict errors (mapping/connection) rethrow → retry → DLQ, so real failures are not masked.
- **Unknown/MenuItem events are a clean skip** (`apply-restaurant-search-event.ts:58-62`) — `return`, not throw; no partition stall, no DLQ noise.
- **Consumer group `search-catalog-projection` is independent** of catalog's group — separate offsets, no collision.
- **Hexagonal boundaries respected.** Domain (`restaurant-search-document.ts`, port) imports no `@elastic/elasticsearch`; the ES client is confined to `infrastructure/`; `app.module.ts` is the only cross-layer file. No plan/phase/finding tokens in code. Files < 200 lines.
- **DLQ / retry semantics** (`message-processing.ts`) route exhausted handlers and undecodable messages to the DLQ and only commit after a durable DLQ write — no silent loss.
- **Input bounds present** where they matter: `q` trimmed + `IsNotEmpty` + `MaxLength` (128 search / 64 autocomplete); `limit` capped (100 / 25). Only `page` is uncapped (H1).

---

## Unresolved questions

1. Is showing `isActive=false` restaurants in diner-facing search/autocomplete intended, or should the read surface filter to active-only? (L1)
2. Confirm the target deploy runs a **single** search replica during first boot; if multi-replica, M1 needs the create-race fix before rollout.
3. For M2: acceptable to keep ms-timestamp versioning (document the same-ms limitation), or switch the projection version to the Kafka partition offset for a strictly-monotonic guard?
4. Does the P6 reindex plan cover the initial backfill of restaurants that exist in catalog *before* search is first deployed (L2), or is search assumed to start alongside an empty catalog?
