# Slice 4a — Search service (Elasticsearch, consumes `catalog.events`)

Context: [phase-04.md](./phase-04-search-realtime-media.md) · [phase-03b.md](./phase-03b-catalog-outbox-debezium-cqrs.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P1 — first P4 track; the others (delivery, media) are independent later slices.
- **Status**: ✅ Verified — search-e2e GREEN on live compose stack (`core`+`messaging`+`search`, ES 9.4.4). catalog write → `catalog.events` → search projection → ES: searchable within seconds, **synonym `phở,pho` + asciifolding** proven (`q=pho` matches "Phở Thìn Lò Đúc"), **edge-ngram autocomplete** (`q=ph`), tenant isolation, rename, delete. External-version guard (occurredAt epoch) against resurrection. Unit 18, gateway 17 (no regression), tsc/biome/dependency-cruiser(468)/knip clean.

**Adversarial review: no Critical, no tenant leak** (isolation verified end-to-end — both query builders unconditionally add the `tenantId` filter from the verified identity). Fixes applied: **H1** deep-pagination guard (`page*limit > 10000` → 400 instead of an uncaught ES 5xx / DoS lever; unit-tested); **M1** bootstrap swallows `resource_already_exists_exception` (multi-replica first-boot race); **M2** projection versioning switched `external` → `external_gte` so a legitimate same-millisecond update is no longer silently dropped, while still rejecting genuinely-older writes — kept epoch-millis (logical time) over the reviewer-suggested Kafka offset **on purpose**: offset resets to 0 on topic re-creation (frequent in dev compose down/up) which would strand the persisted ES index, whereas logical time survives it. Deferred (documented): **L** fresh-index backfill of restaurants that predate search's first deploy (a reindex-from-catalog job) → folds into P6's reindex; whether diner search should hide `isActive=false` restaurants is a product decision left as current behaviour (show all same-tenant). Review report: `reports/code-reviewer-260728-2150-slice-4a-search-elasticsearch-red-team-review-report.md`.
- **Brief**: New `apps/search` service consumes `catalog.events` (the topic 3b already publishes) into an Elasticsearch index that is a **read model** (never source of truth). Teaches text analysis: VN-friendly analyzer (lowercase + asciifolding), edge-ngram autocomplete, synonym filter, and `function_score` ranking. Exposes search + autocomplete query endpoints via the gateway.

## Key decisions (versions verified live 2026-07-28)
- **ES `elasticsearch:9.4.4`** single-node, `search` compose profile, heap-capped `-Xms512m -Xmx512m`, security disabled for dev (`xpack.security.enabled=false`), single-node discovery.
- **Client = `@elastic/elasticsearch@9.4.2`** wrapped in our own Nest module (hexagonal, mirrors how `libs/shared/messaging` wraps Kafka) — NOT `@nestjs/elasticsearch` (thin wrapper we'd re-wrap anyway).
- **Consumer reuses `libs/shared/messaging`**: `KafkaConsumerSubscriber` (tenant scope from header, DLQ, manual commit) + `IdempotentConsumer.runOnce` dedupe by `x-event-id`. Search is a NEW consumer group `search-catalog-projection` on `catalog.events` — parallel to catalog's own `catalog-projection` group (independent offsets).
- **Rating-boost ranking is stubbed**: a `rating` field defaults to 0 in the mapping + `function_score` weights it, but reviews arrive in P6 — the ranking wiring exists now, the data later. Do NOT invent fake ratings.
- Index **restaurants** first (menu items as a second doc type or index if cheap). One doc per restaurant, keyed by restaurant id; delete on `RestaurantDeleted`.

## Requirements
**Functional**: `catalog.events` → upsert/delete ES docs (idempotent by aggregate id, tenant-scoped from the envelope); `GET /search/restaurants?q=` full-text (analyzer + synonym) ranked by relevance (+rating weight); `GET /search/restaurants/autocomplete?q=` edge-ngram prefix. Results tenant-filtered.
**Non-functional**: write in catalog → searchable within seconds; projection idempotent + tenant-scoped; ES single-node fits 16GB alongside `core`+`messaging`; reindex idempotent from events (upsert by id); index bootstrapped idempotently on service start (create-if-absent).

## Architecture / data flow
```
catalog write (3b) ──▶ catalog.events (Kafka) ──▶ search consumer group `search-catalog-projection`
   RestaurantCreated/Updated ─▶ ES upsert doc(id) {tenantId,name,description,isActive,rating=0,...}
   RestaurantDeleted          ─▶ ES delete doc(id)
                                        ▲
   GET /search/restaurants(:q) ─▶ multi_match (analyzed) + function_score(rating) ─┘  (tenant filter term)
   GET /search/restaurants/autocomplete(:q) ─▶ match on edge-ngram field
```

## Index settings (bootstrap)
- Analyzer `vn_text`: `standard` tokenizer + `lowercase` + `asciifolding` (VN diacritics) + a `synonym` filter (small curated set, e.g. `phở, pho`; `bún, bun`; `bánh mì, banh mi, banhmi`).
- Field `name`: `text` (analyzer `vn_text`) + sub-field `name.autocomplete` (edge-ngram 2–15, search analyzer `vn_text` without ngram) + `name.keyword`.
- Field `description`: `text` (`vn_text`). `tenantId`, `isActive`: `keyword`/`boolean` (filter). `rating`: `float` (default 0, for `function_score`). `restaurantId` etc for menu docs.
- Query: `multi_match` over `name^3, description` wrapped in `function_score` with a `field_value_factor`/`weight` on `rating` (modest boost). Autocomplete: `match` on `name.autocomplete`.

## Related code files (to create)
- `apps/search/` — Nx app (project.json tags `scope:search, type:app`, tsconfig*, jest, webpack, main.ts headless-or-HTTP). It exposes an HTTP query API, so a normal Nest HTTP app (not headless).
- `apps/search/src/config/search-env-schema.ts` — `PORT` (new port, e.g. 3004), `ELASTICSEARCH_NODE` (http://localhost:9200), `KAFKA_BROKERS`, `KAFKA_CLIENT_ID=search`.
- `apps/search/src/infrastructure/elasticsearch/*` — ES client module (wrap `@elastic/elasticsearch`), index bootstrap (settings/mappings, create-if-absent), `RestaurantSearchRepository` adapter (upsert/delete/search/autocomplete).
- `apps/search/src/domain/*` — ports (`RESTAURANT_SEARCH_REPOSITORY`), the doc model, query result types.
- `apps/search/src/interface/messaging/catalog-projection.consumer.ts` — subscribe `catalog.events`, idempotent upsert/delete into ES (tenant-scoped).
- `apps/search/src/interface/http/search.controller.ts` + DTOs — `GET /search/restaurants`, `/autocomplete`.
- `apps/search/src/application/*` — search + autocomplete query handlers, projection apply handler.
- `infra/docker-compose.yml` — `elasticsearch` service (`search` profile). `.env.example` — ES + search keys. `package.json` — add `search` to `dev`; no migrations (ES has no SQL migration — index bootstrap on boot).
- `apps/gateway/*` — proxy `/api/v1/search/*` to the search service (public read, like catalog reads). OpenAPI note.
- `apps/search-e2e/` — testcontainers ES (`@elastic/elasticsearch` has an official testcontainer? use `@testcontainers/elasticsearch` if it exists, else generic container) OR compose-based e2e (orchestrator runs). Prefer a compose-based e2e that drives catalog → catalog.events → search, mirroring the catalog CDC e2e.

## Implementation steps
1. Scaffold `apps/search` (mirror a small HTTP app: catalog's shape for HTTP + config/persistence-less). Tags, tsconfig, webpack.
2. ES client Nest module + index bootstrap (idempotent create with settings/mappings) run on `OnApplicationBootstrap` (guarded under NODE_ENV=test like the relays if needed).
3. `RestaurantSearchRepository` (ES adapter): `upsert(doc)`, `remove(id, tenantId)`, `search(tenantId, q, page)`, `autocomplete(tenantId, q)`.
4. `catalog.events` consumer: `IdempotentConsumer.runOnce` (needs a dedupe store — ES has no tx; use a simple ES `processed_events` index OR accept ES upsert idempotency by id + version and dedupe by doc version — DECIDE: ES upserts are naturally idempotent by id, so a redelivered Created/Updated re-writes the same doc = safe; a stale Updated after Delete could resurrect — handle via event ordering per aggregate (same key→same partition→ordered) + treat Delete as terminal. Document the choice; full dedupe-ledger optional).
5. Query handlers + HTTP controller; tenant filter from the trusted identity (gateway-verified header, like catalog).
6. Compose ES service + gateway proxy + `.env.example` + `dev` script.
7. **E2E** (compose `core`+`messaging`+`search`): create/update a restaurant via catalog HTTP → within seconds `GET /search/restaurants?q=` finds it; autocomplete prefix hits; synonym query matches; another tenant can't see it; delete → gone from search.
8. Update plan todos/status BEFORE push.

## Todo
- [x] `apps/search` scaffolded (Nx app, tags, config, ES client module)
- [x] ES index bootstrap (vn_text analyzer + synonym + edge-ngram autocomplete + rating function_score)
- [x] `catalog.events` consumer → idempotent tenant-scoped upsert/delete into ES
- [x] search + autocomplete query endpoints (tenant-filtered) via gateway
- [x] compose ES (`search` profile) + gateway proxy + `.env.example` + `dev` script
- [x] E2E written (compose-based; run by orchestrator): catalog write → searchable + autocomplete + synonym + tenant isolation + rename + delete
- [x] biome/cruiser/knip/tsc clean; unit tests (env schema, projection mapping, query builder); plan updated before push

## Success criteria
- Updating a restaurant name in catalog makes it findable in search within seconds; autocomplete returns prefixes; synonym query matches; `rating` weight wired (data lands in P6).
- Search results tenant-filtered; `RestaurantDeleted` removes the doc.
- ES single node fits alongside `core`+`messaging`; index bootstrapped idempotently.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| ES RAM on 16GB | M×H | Single node, `-Xms512m -Xmx512m`, only needed profiles up |
| Reindex drift vs catalog | M×M | Idempotent upsert keyed by id; per-aggregate ordering (key=id); Delete terminal; full-reindex-from-read-model note (P6) |
| Stale Updated resurrects a deleted doc | L×M | Same-key→same-partition ordering; document; optional `version`/`_seq_no` guard |
| ES testcontainer availability | L×M | Use `@testcontainers/elasticsearch` if present, else compose-based e2e (orchestrator runs) |
| Synonym/analyzer correctness | L×M | Curated small synonym set + unit/e2e asserting a known synonym + accent-folded hit |

## Security considerations
- Search results tenant-filtered (term on `tenantId` from the gateway-verified identity, never a raw client header).
- ES on internal network; `:9200` dev-exposed only, never via Nginx. Security disabled for DEV only (documented; TLS+auth = P8).
- Query input validated/bounded (max length, pagination caps) to avoid expensive queries.

## Next steps
Unblocks P4 delivery + media (independent). P6 review events populate `rating` → ranking becomes meaningful; add a review-events consumer then.
