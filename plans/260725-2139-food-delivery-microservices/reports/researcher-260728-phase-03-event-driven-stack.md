# Research — P3 event-driven stack (Kafka / Debezium / Saga / CQRS)

Date: 2026-07-28 · Scope: Phase 3 backbone · Plan: [phase-03](../260725-2139-food-delivery-microservices/phase-03-event-driven-backbone.md)
Method: 2 parallel researchers + live re-verification (npm registry + WebSearch). All version claims re-checked live — the two researchers **conflicted on Debezium** (one said 3.6.0.Final, one said 3.4/"3.5 beta"); resolved live below.

## Chosen versions (live-verified 2026-07-28)

| Component | Version / image | Source of truth |
|-----------|-----------------|-----------------|
| Apache Kafka | `apache/kafka:4.3.1` (2026-06-25, latest stable) | WebSearch kafka.apache.org/blog/releases |
| Debezium (Kafka Connect) | `quay.io/debezium/connect:3.6.0.Final` (2026-07-01, latest Final) | WebSearch debezium.io/releases/3.6 — **overrides** the 3.4/"3.5-beta" claim (3.5.2.Final + 3.6.0.Final both shipped) |
| Node Kafka client | `@confluentinc/kafka-javascript@1.10.0` | `npm view` live |
| e2e | `@testcontainers/kafka@12.0.4` | `npm view` live (researcher's 11.14.0 was stale) |
| (rejected) kafkajs | `2.2.4` — **last release 2023, unmaintained** | `npm view` |
| (rejected) @nestjs/microservices Kafka | `11.1.28` — couples to kafkajs | `npm view` |

Prior plan pins (`kafka:4.0.0`, `debezium:3.5`) were stale → architecture.md tech table updated.

## Key decisions + rationale

**Kafka client → `@confluentinc/kafka-javascript`, wrapped in `libs/shared/messaging`.**
kafkajs is de-facto dead (3 yrs no release); `@nestjs/microservices` Kafka transport is coupled to it AND its request/reply model fights our outbox + manual-commit + saga design — we need a hand-rolled wrapper regardless, so pick the actively-maintained Confluent/librdkafka client. Native addon is fine on our **glibc** `node:24-bookworm-slim` images (repo already mandates glibc over musl for native modules: bcrypt, grpc, sharp); prebuilt arm64 binaries exist → no compile on M4 host. Fallback (kafkajs+@nestjs/microservices) documented, not chosen. ⚠️ open question for user below.

**Outbox implemented TWO ways (learning goal, per plan):**
- **catalog → Debezium CDC**: app writes only an `outbox` row (Event-Router columns) in the domain tx; Debezium tails WAL (pgoutput) + Outbox Event Router SMT → `catalog.events`. Full connector JSON in [phase-03b](../260725-2139-food-delivery-microservices/phase-03b-catalog-outbox-debezium-cqrs.md). Requires Postgres `wal_level=logical` + a least-priv `debezium` replication role.
- **order/inventory/payment → app polling publisher**: `OutboxRelay` (in shared lib) drains `<svc>_outbox` (`FOR UPDATE SKIP LOCKED`), produces, marks published.

**Saga = orchestration** in `order` (central coordinator), persisted `order_saga` state, optimistic-locked + idempotent (`processed_events` dedupe by event id in the effect tx). Choreography documented as alternative. Reserve/charge become Kafka command/reply; **inventory reuses its already-idempotent P2 handlers** via a new messaging interface adapter (hexagonal payoff — domain untouched). Payment = deterministic STUB (`fail if totalCents===PAYMENT_STUB_FAIL_AT_CENTS`); real Temporal + DLQ = P5.

**CQRS (catalog)**: projection consumer builds denormalized read tables (`read_restaurants`/`read_menu_items`) in the catalog DB (Redis deferred, YAGNI); read endpoints served from them.

**Partitioning**: 6 topics, `partitions=3, RF=1`, keyed by aggregate id (order_id / restaurant_id) to actually exercise partition-key ordering.

## RAM budget (16 GB Mac Air M4)
`core` (PG18+Redis+5 Node svcs) ~1.5-2 GB + Kafka broker (heap 512m) ~0.3-1 GB + Connect/Debezium (heap 512m) ~0.7-1.2 GB ⇒ **core+messaging ≈ 3.2-4.9 GB**; +auth (Keycloak ~0.7) ≈ 3.9-5.6 GB. Fits comfortably. Tuning applied: `offsets/transaction-state/connect-storage replication.factor=1`, `group.initial.rebalance.delay.ms=0`.

## Sliced plan summary
- **3a** `feat/shared-messaging-kafka` — `messaging` profile (Kafka only) + `libs/shared/messaging` (producer, consumer, header codec, `OutboxRelay`, `IdempotentConsumer`) + testcontainers Kafka round-trip. Dep: P2.
- **3b** `feat/catalog-outbox-cqrs` — catalog outbox (in-tx) + Kafka Connect/Debezium + connector → `catalog.events` + projection → read model + read endpoints. Dep: 3a.
- **3c** `feat/order-saga-events` — order polling outbox + saga orchestrator + async place-order; inventory command consumer (reuse) + payment STUB. Dep: 3a.
- **3d** `test/order-saga-compensation-e2e` — 9-row failure/compensation/idempotency + CDC matrix. Dep: 3b+3c.

Order: `3a → {3b,3c} → 3d`; 3b/3c share `docker-compose.yml`+`architecture.md` → sequence those edits. Single-dev: `3a→3b→3c→3d`.

## Postgres CDC prerequisites (3b)
`wal_level=logical`, `max_wal_senders>=10`, `max_replication_slots>=10` on the existing `postgres:18.4`; `pgoutput` is built-in (no wal2json); Debezium auto-creates publication + slot; `snapshot.mode=no_data` (backfill read model explicitly, don't snapshot history).

## Open questions (for user)
1. **Kafka client**: confirm `@confluentinc/kafka-javascript` (native librdkafka, enterprise-grade, active) over the KISS `@nestjs/microservices`+kafkajs (pure-JS but dead)? Recommendation: Confluent. Build-toolchain in Docker builder stage is the only cost; prebuilt arm64 binaries likely avoid it.
2. **Schema management**: JSON payloads inline (chosen, KISS) vs a Schema Registry (Avro/Protobuf). Registry deferred; add if multi-consumer contract drift bites in P4/P6. OK to defer?
3. **Read model store**: catalog read tables in Postgres (chosen) vs Redis. Redis deferred (YAGNI). OK?
4. **Async order API**: `POST /orders` becomes `202 PENDING` + client polls `GET /orders/:id`. Confirms the contract change is acceptable (vs. keeping a sync facade that blocks on the saga)?
5. **Inventory gRPC**: keep the P2 gRPC reserve server (unused by order after 3c) or remove it? Keeping is harmless but knip may flag order's `InventoryGrpcAdapter` (removed in 3c). Lean: remove order's gRPC inventory path; keep/deprecate inventory's gRPC server.
6. **Dual advertised listeners**: single `PLAINTEXT://kafka:9092` assumed; if host e2e can't reach the broker, add a `HOST://…:9092` listener advertised as `localhost`. Confirm at 3a first boot.

Status: DONE
</content>
