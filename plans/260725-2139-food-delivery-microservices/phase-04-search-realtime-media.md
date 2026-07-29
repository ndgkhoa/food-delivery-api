# Phase 4 — Search & Real-time & Media

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P1
- **Status**: ✅ Done — all three tracks merged: 4a #15 (Elasticsearch search consuming `catalog.events`) · 4b #16 (delivery WebSocket + Redis GEO + `order.events` assignment) · 4c #17 (MinIO presigned uploads + BullMQ/sharp thumbnails). Each proven live (search/delivery/media e2e green) + adversarially reviewed (double-booking, WS-auth race, upload-OOM Criticals fixed). gRPC delivery server + Kafka `media.uploaded` deferred until a consumer needs them.
- **Brief**: Three user-facing capabilities on the P3 backbone: (1) `search` consumes `catalog.events` into Elasticsearch (analyzer/tokenizer/synonym/autocomplete/ranking); (2) `delivery` streams driver location via WebSocket + Redis GEO + gRPC; (3) `media` handles image upload to MinIO with thumbnails + presigned URLs.
- Three independent tracks — can be built in parallel by different sessions (distinct files/services).

## Key insights
- Search ONLY consumes events; Debezium stays in catalog (P3). Search index is a read model, never source of truth.
- ES teaches text analysis: custom analyzer (lowercase+asciifolding for VN), edge-ngram autocomplete, synonym filter, function_score ranking (rating/distance boost).
- Delivery: driver pushes location over WS → stored in Redis GEO → geo-radius query finds nearby drivers; gRPC used for order→delivery assign + server-to-server location stream.
- Media: never proxy bytes through the app — client uploads/downloads directly via MinIO presigned URLs; app only issues URLs + stores metadata + generates thumbnails on an event/worker.

## Requirements
**Functional**: search restaurants/menu by text with autocomplete + synonyms, ranked by relevance+rating; live driver location on a map channel; nearby-driver query; image upload→thumbnail→presigned retrieval.
**Non-functional**: ES single-node fits 16GB (`search` profile); WS scales via Redis pub/sub adapter; presigned URLs short-lived; search reindex idempotent from events.

## Architecture
- `search`: Kafka consumer on `catalog.events` → transform → ES index; query API via gateway. Index settings: analyzer, edge-ngram autocomplete field, synonym filter, function_score.
- `delivery`: WS gateway (Socket.IO or ws) + Redis adapter; Redis GEO (`GEOADD`/`GEOSEARCH`); gRPC `LocationStream` + `Assign`; consumes `order.events` (assign on CONFIRMED).
- `media`: presigned PUT/GET issuance; on `media.uploaded` event a BullMQ worker generates thumbnails (sharp) back into MinIO.
- Profiles used: `core` + `messaging` + `search` (+ MinIO in core or its own).

## Related code files (to create)
- `apps/search/*` — ES client, index template/settings, catalog.events consumer, query controller
- `apps/delivery/*` — WS gateway, Redis GEO service, gRPC server (assign + location stream), order.events consumer
- `apps/media/*` — MinIO client, presigned URL issuer, thumbnail BullMQ worker, metadata store
- `infra/*` — ES single-node (`search` profile), MinIO service; ES index bootstrap script
- `libs/shared/contracts` — delivery `.proto`

## Implementation steps
1. Add ES 9.4 single-node (`search` profile) + MinIO. Bootstrap index with custom analyzer/synonyms/autocomplete/function_score.
2. `search`: consume `catalog.events`, upsert docs, expose search + autocomplete endpoints via gateway.
3. `delivery`: WS gateway + Redis adapter; `GEOADD` on location push; `GEOSEARCH` nearby endpoint; gRPC assign + stream; consume order CONFIRMED → assign driver.
4. `media`: presigned PUT/GET; emit `media.uploaded`; BullMQ worker builds thumbnails; store metadata.
5. E2E: index a restaurant via catalog update → searchable + autocomplete + synonym hit; driver location updates live over WS + nearby query; upload image → thumbnail + presigned GET works.

## Todo
- [ ] ES index (analyzer/synonym/autocomplete/ranking) bootstrapped
- [ ] search consumes catalog.events → ES; query + autocomplete endpoints
- [ ] delivery WS + Redis GEO + gRPC assign/stream + order.events consume
- [ ] media presigned URLs + thumbnail worker + metadata
- [ ] E2E: search/autocomplete/synonym, live location+nearby, image upload+thumbnail

## Success criteria
- Updating a restaurant name in catalog makes it findable in search within seconds; autocomplete returns prefixes; synonym query matches; higher-rated ranks first.
- Two clients: driver moves → rider sees live position; nearby query returns correct drivers by radius.
- Client uploads directly to MinIO via presigned PUT; thumbnail generated; GET via presigned URL.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| ES RAM pressure on 16GB | M×H | Single node, `-Xms512m -Xmx512m`, only needed profiles up |
| Reindex drift vs catalog | M×M | Idempotent upserts keyed by id; full-reindex job from read model |
| WS scaling/state | M×M | Redis adapter; stateless handlers; heartbeat/timeout |
| Presigned URL leakage | M×M | Short TTL, scoped object keys, tenant prefix |

## Security considerations
- Search results tenant-filtered. Presigned URLs least-privilege + short TTL + per-tenant bucket prefix.
- WS auth: validate JWT on connect; authorize driver vs customer channels. Rate-limit location pushes.
- Validate/limit image MIME + size before issuing presigned PUT.

## Next steps
Feeds P6 (review rating boosts search ranking; review events → ES). Delivery tracking consumed by notification (P5) for status pushes.
