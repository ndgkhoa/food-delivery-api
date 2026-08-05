# Slice 3b — Catalog Outbox (Debezium CDC) + CQRS read model

Context: [phase-03.md](./phase-03-event-driven-backbone.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)
Report: [researcher-260728-phase-03-event-driven-stack.md](../reports/researcher-260728-phase-03-event-driven-stack.md)

## Overview
- **Priority**: P0
- **Status**: ✅ Verified — full Outbox→Debezium→Kafka→projection→read-model chain proven live (connector RUNNING, `catalog.events` carries all 6 envelope headers, read model + `processed_events` populated, tenant isolation 404). Static gates clean (tsc/biome/cruiser 367 modules/knip), catalog unit 50/50, catalog-e2e 13/13. **Real bug found+fixed during verify**: connector `event.timestamp: created_at` killed the EventRouter task (`Field 'created_at' is not of type INT64`) — removed; `x-occurred-at` comes via header placement (see connector Notes).

**Adversarial code-review done — no Critical, no tenant leak; idempotency tx boundary verified solid. All findings addressed:**
- **M1 (orphan menu-item read rows)** — restaurant vs item on different Kafka partitions; a bulk read-model cascade on RestaurantDeleted couldn't be ordered against an in-flight item update → orphan. **Fixed**: delete handler now enumerates live items and emits a per-item `MenuItemDeleted` keyed by item id, so each item's own partition carries its terminal event in order. **Verified live**: create restaurant+2 items (read model 1/2) → delete → read_restaurants=0, read_menu_items=0, outbox `MenuItemDeleted×2`+`RestaurantDeleted×1`. removeByRestaurant kept as immediate common-case cleanup.
- **M2 (down migration couldn't DROP ROLE debezium — dependent grants)** — fixed with `DROP OWNED BY debezium` before `DROP ROLE`.
- **L1** projection-disabled-in-test now `logger.warn` (not silent). **L3** `correlationid` column now `NOT NULL` (matches the always-set, fail-closed invariant). **L4** backfill count uses `RETURNING id` (was always 0).
- Deferred (documented): **L2** poison-skip read gap → 3d/P5 DLQ; **L5** outbox prune + named slot WAL headroom → P5; **L6** dev connector password kept out of prod config.
Review report: `../reports/code-reviewer-260728-1420-slice-3b-catalog-outbox-cqrs-red-team-review-report.md`. Ready to merge.
- **Branch**: `feat/catalog-outbox-cqrs`
- **Brief**: Add a Debezium-routed outbox to catalog: every restaurant/menu-item write inserts an `outbox` row in the SAME tx as the domain change. Kafka Connect + Debezium tails the WAL and the Outbox Event Router SMT publishes to `catalog.events`. A projection consumer (in catalog) builds a denormalized **read model**; catalog's list/get endpoints are switched to serve from it. Teaches Outbox-via-CDC + CQRS in one vertical slice.

## Key insights / decisions
- **Relay = Debezium (CDC)** here — contrasts with 3c's polling relay. The app writes only the outbox row; Debezium does emission. No app-side publisher for catalog.
- Outbox table columns follow the **Outbox Event Router** conventions (`aggregatetype/aggregateid/type/payload`) so the SMT needs minimal config. `aggregatetype='catalog'` → routes to `catalog.events`; `type` header distinguishes `RestaurantUpdated` vs `MenuItemCreated` etc.
- Read model is a **denormalized table in the catalog DB** (KISS; not Redis) — one row per restaurant with its menu embedded as JSONB, or a flattened `read_menu_items` + `read_restaurants` pair. Chosen: two read tables mirroring the query shapes (list restaurants, get restaurant+menu). Redis read model deferred (YAGNI; revisit if read latency demands).
- Projection consumer is **idempotent** (dedupe by event id via `processed_events`) and **tenant-scoped** (reopens tenant context from the header).
- Outbox rows: **insert-only**, pruned by a periodic job (delete published rows older than N days). Delete-in-same-tx (self-cleaning) documented as the alternative; insert-only keeps a debuggable audit trail (KISS for learning).

## Requirements
**Functional**: catalog write handlers (create/update/delete restaurant + menu-item) insert an outbox row atomically with the change; Debezium publishes to `catalog.events`; projection consumer upserts the read model; `GET /restaurants`, `GET /restaurants/:id` (+ menu) serve from the read model.
**Non-functional**: write appears in read model within seconds; projection idempotent + tenant-scoped + ordered per aggregate (key=aggregateid); Connect heap-capped; Postgres `wal_level=logical` enabled without breaking existing services.

## Architecture / data flow
```
catalog write handler ──tx──▶ [restaurants|menu_items] + [outbox row]   (one Postgres tx)
                                        │ WAL (logical)
                        Debezium (Kafka Connect, pgoutput) tails outbox table
                                        │ Outbox Event Router SMT
                                        ▼
                             Kafka topic: catalog.events  (key=aggregateid)
                                        ▼
             catalog projection consumer (group) ──▶ dedupe(event id) + tenant.run
                                        ▼
                     [read_restaurants] / [read_menu_items]  (denormalized)
                                        ▲
                     catalog read endpoints (list/get) query these
```

## Related code files
**Create:**
- `apps/catalog/src/infrastructure/persistence/migrations/*-create-catalog-outbox.ts` — `outbox` table (Event-Router columns) + `processed_events` + `read_restaurants` + `read_menu_items`.
- `apps/catalog/src/domain/shared/outbox.port.ts` — `OUTBOX_PORT` + `OutboxWriter { write(entry): Promise<void> }` (domain port).
- `apps/catalog/src/infrastructure/outbox/typeorm-outbox.adapter.ts` — inserts the outbox row via the current tx's entity manager.
- `apps/catalog/src/infrastructure/outbox/catalog-event.factory.ts` — builds `EventEnvelope` payloads from domain models (RestaurantCreated/Updated/Deleted, MenuItem*).
- `apps/catalog/src/interface/messaging/catalog-projection.consumer.ts` — subscribes `catalog.events`, upserts read model (idempotent).
- `apps/catalog/src/application/*/queries/*` — switch `ListRestaurants`/`GetRestaurant`/`ListMenuItems` to read-model repositories (or add read-model repos + point handlers at them).
- `apps/catalog/src/domain/read-model/*.repository.ts` + `infrastructure/persistence/repositories/typeorm-read-*.repository.ts` + entities/mappers.
- `infra/debezium/catalog-outbox-connector.json` — Debezium connector config.
- `infra/docker-compose.yml` — add `kafka-connect` (Debezium) service (profile `messaging`); add `wal_level=logical` (+ slots) to the existing `postgres` service `command`.
- `infra/debezium/register-connectors.sh` — POSTs the connector JSON to `localhost:8083/connectors` (idempotent PUT to `/config`).

**Modify:**
- `apps/catalog/src/app.module.ts` — bind `OUTBOX_PORT`, register projection consumer + read-model repos + `OutboxRelay`? (No relay — Debezium does emission; only the consumer + writer here.)
- Catalog write handlers — add `outboxWriter.write(event)` inside the existing `runInTransaction` (create/update/delete restaurant + menu-item). Audit + outbox share the commit boundary.

## Debezium connector JSON (Debezium 3.6.0.Final, pgoutput)
```json
{
  "name": "catalog-outbox-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "tasks.max": "1",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "${file:/run/secrets/...}",
    "database.dbname": "catalog",
    "topic.prefix": "catalog-cdc",
    "plugin.name": "pgoutput",
    "publication.name": "dbz_catalog_outbox",
    "publication.autocreate.mode": "filtered",
    "table.include.list": "public.outbox",
    "snapshot.mode": "no_data",

    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
    "transforms.outbox.route.by.field": "aggregatetype",
    "transforms.outbox.route.topic.replacement": "${routedByValue}.events",
    "transforms.outbox.table.field.event.id": "id",
    "transforms.outbox.table.field.event.key": "aggregateid",
    "transforms.outbox.table.field.event.type": "type",
    "transforms.outbox.table.field.event.payload": "payload",
    "transforms.outbox.table.expand.json.payload": "true",
    "transforms.outbox.table.fields.additional.placement": "id:header:x-event-id,type:header:x-event-type,aggregateid:header:x-aggregate-id,tenant_id:header:x-tenant-id,correlationid:header:x-correlation-id,created_at:header:x-occurred-at",

    "key.converter": "org.apache.kafka.connect.json.JsonConverter",
    "key.converter.schemas.enable": "false",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false",
    "tombstones.on.delete": "false"
  }
}
```
Notes: `aggregatetype='catalog'` on every outbox row → topic `catalog.events`. `aggregateid` → message key → per-restaurant ordering across 3 partitions. **All 6 envelope headers the lib's `decodeHeaders` requires are produced via `additional.placement`** (`x-event-id/x-event-type/x-aggregate-id/x-tenant-id/x-correlation-id/x-occurred-at`). **Do NOT set `event.timestamp: created_at`** — the EventRouter's `event.timestamp` maps to the Kafka *record* timestamp and requires an INT64 epoch; a `timestamptz` column serializes as a Debezium ZonedTimestamp and the SMT throws `Field 'created_at' is not of type INT64`, killing the task. `x-occurred-at` (ISO string) comes from the header placement instead — verified live. `snapshot.mode=no_data` (outbox starts empty; we don't want to snapshot historical restaurants — the read model is bootstrapped by re-emitting or by a one-off backfill, see risks).

## Kafka Connect / Debezium compose service
```yaml
kafka-connect:
  image: quay.io/debezium/connect:3.6.0.Final    # latest stable Final (2026-07-01); Postgres connector bundled
  container_name: food-delivery-kafka-connect
  profiles: [messaging]
  depends_on: { kafka: { condition: service_healthy } }
  ports: ["8083:8083"]
  environment:
    BOOTSTRAP_SERVERS: "kafka:9092"
    GROUP_ID: "catalog-connect"
    CONFIG_STORAGE_TOPIC: "connect-configs"
    OFFSET_STORAGE_TOPIC: "connect-offsets"
    STATUS_STORAGE_TOPIC: "connect-status"
    CONFIG_STORAGE_REPLICATION_FACTOR: 1
    OFFSET_STORAGE_REPLICATION_FACTOR: 1
    STATUS_STORAGE_REPLICATION_FACTOR: 1
    KAFKA_HEAP_OPTS: "-Xmx512m -Xms512m"
  healthcheck:
    test: ["CMD-SHELL", "curl -sf localhost:8083/ || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
```
Postgres change (existing `postgres` service `command`): `-c wal_level=logical -c max_wal_senders=10 -c max_replication_slots=10`. Add a `debezium` DB role with `REPLICATION`. Approx Connect RAM ~0.7–1.2 GB → total `core`+`messaging` ≈ 3.2–4.9 GB, fits 16 GB.

## Implementation steps
1. Migration: `outbox` (Event-Router columns + `tenant_id`, `correlationid`), `processed_events`, `read_restaurants`, `read_menu_items`.
2. `OUTBOX_PORT` + TypeORM adapter (insert within current tx entity manager). `catalog-event.factory` builds envelopes.
3. Wire `outboxWriter.write(...)` into the 6 catalog write handlers inside their existing `runInTransaction`.
4. Postgres: enable `wal_level=logical` + slots; add `debezium` replication role (SQL in migration/init).
5. Add `kafka-connect` compose service; `register-connectors.sh` PUTs `catalog-outbox-connector` config.
6. Projection consumer: subscribe `catalog.events`; per event `IdempotentConsumer.runOnce` + `tenant.run` → upsert read tables.
7. Read-model repos + entities/mappers; point `ListRestaurants`/`GetRestaurant`(+menu)/`ListMenuItems` queries at them.
8. Backfill: one-off script re-emits current restaurants/menu-items into the outbox (or seed read tables directly) so pre-existing data appears in the read model.
9. **E2E** (compose `core`+`messaging`): create/update a restaurant via HTTP → within seconds `GET /restaurants/:id` (read model) reflects it; assert `catalog.events` carries `x-event-type`/`x-tenant-id`/`x-event-id` headers, keyed by aggregateid. Cross-tenant read still isolated.
10. Update plan todos/status BEFORE push.

## Todo
- [x] migration: outbox + processed_events + read_restaurants + read_menu_items
- [x] `OUTBOX_PORT` + TypeORM outbox adapter + event factory
- [x] outbox write wired into 6 catalog write handlers (in-tx)
- [x] Postgres `wal_level=logical` + `debezium` role
- [x] `kafka-connect` compose service + `register-connectors.sh` + connector JSON
- [x] projection consumer (idempotent + tenant-scoped) → read tables
- [x] read-model repos; list/get endpoints served from read model
- [x] backfill existing catalog data into read model
- [x] E2E RUN GREEN on live compose stack: POST /restaurants → outbox row → Debezium `catalog.events` (6 envelope headers verified on the wire) → projection → `read_restaurants` within seconds; tenant isolation (other tenant 404); `processed_events` deduped; full catalog-e2e suite 13/13 (crud+grpc+cdc) — no CQRS regression
- [x] biome/cruiser/knip clean; build + unit tests green; plan updated before push

## Success criteria
- Restaurant/menu write propagates to the read model within seconds via Outbox→Debezium→Kafka→projection.
- `catalog.events` messages carry correct headers + aggregateid key; same-aggregate order preserved.
- Read endpoints return read-model data; tenant isolation intact; connector visible & RUNNING at `:8083/connectors`.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| `wal_level=logical` change disrupts existing services | M×M | Additive Postgres flag; test `core` boot before adding messaging; documented in `.env`/compose |
| Read model vs write model divergence (missed event) | M×M | Idempotent upsert; projection replays from offset; backfill + periodic reconcile note (P5) |
| Connector fails silently | M×M | `register-connectors.sh` checks status; e2e asserts a known change lands; version JSON committed |
| Outbox table growth | L×M | Insert-only + periodic prune of published rows; or delete-in-tx alternative documented |
| Snapshot of historical rows floods topic | L×M | `snapshot.mode=no_data`; explicit backfill script instead |
| Malformed JSON payload → SMT drop | L×M | `payload` is JSONB; event factory is the only writer → shape guaranteed |

## Security considerations
- `debezium` DB role least-privilege (REPLICATION + SELECT on outbox only).
- Events carry `tenant_id` header; projection reopens tenant scope and writes tenant-scoped read rows; reads stay tenant-filtered.
- Connect + Kafka internal-network only; `:8083` dev-exposed, never via Nginx.
- Outbox is the sole emission source of truth; handlers never publish directly.

## Next steps
`catalog.events` feeds P4 search (ES index) + P6 analytics/review. Read model pattern reused when ES lands. Independent of 3c but shares `infra/docker-compose.yml` + `architecture.md` — sequence edits to avoid conflict.
</content>
