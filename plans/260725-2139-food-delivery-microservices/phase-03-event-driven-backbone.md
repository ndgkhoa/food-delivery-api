# Phase 3 — Event-driven backbone (Kafka, Outbox, Debezium, Saga, CQRS)

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md) · [development-workflow.md](./development-workflow.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P0 (core distributed-systems learning)
- **Status**: ✅ Done — all four slices merged (3a #10 messaging substrate · 3b #11 catalog CDC+CQRS · 3c #12 order saga+outbox+payment stub · 3d #13 DLQ+reaper+compensation e2e). Full failure/compensation/idempotency matrix proven live; zero oversell/double-charge under concurrency + duplicate injection. Deferred to P5: Temporal-backed saga timeouts, DLQ replay/pruning, Prometheus metrics, Schema Registry.
- **Decisions locked** (confirmed): Kafka client = `@confluentinc/kafka-javascript`; order API async (`202 PENDING` + poll `GET /orders/:id`); order's inventory reserve moves from gRPC to Kafka command/reply (inventory becomes an event consumer); Schema Registry + Redis read model deferred (JSON payloads + Postgres read tables for now).
- **Brief**: Introduce Kafka. Replace P2's inline synchronous order flow with an **orchestrated Saga** (order → inventory → payment-stub) driven by Kafka command/reply events, made reliable by the **Transactional Outbox** pattern implemented TWO ways — Debezium CDC (catalog) and an app polling publisher (order) — so both are learned. Build a **CQRS read model** for catalog fed by its events. This is the phase that turns coupled services into an event-driven system.

## Key insights
- **Outbox** = write domain change + event row in ONE Postgres tx → a relay publishes → no dual-write loss. Two relays on purpose: **Debezium (CDC/WAL)** for catalog and a **Nest polling publisher** for order. Teaches the canonical reliability pattern from both angles.
- **Saga orchestration** (central coordinator in `order`) chosen over choreography for visibility/learning; choreography documented as the alternative.
- The order API becomes **asynchronous**: place-order persists `PENDING` + emits the first saga command and returns immediately; the client polls `GET /orders/:id` for `CONFIRMED`/`CANCELLED`. This is the deliberate contract change that motivates the whole phase.
- **Idempotent consumers** (dedupe by event id in the same tx as the effect) + **partition-key ordering** (key by aggregate id) are non-negotiable once effects are async.
- **CQRS read model**: catalog write model (normalized) vs read model (denormalized) updated from events — teaches read/write separation before Event Sourcing in P4.
- Payment is a **STUB** (deterministic ok/fail via a configured trigger amount); real Temporal workflow + DLQ arrives P5. Keeps this phase focused.

## Slice breakdown (one PR each — mirrors P1/P2 slicing)

| Slice | Branch (example) | Delivers | Depends on |
|-------|------------------|----------|-----------|
| **3a** | `feat/shared-messaging-kafka` | `messaging` compose profile (Kafka 4.x KRaft single broker) + `libs/shared/messaging` (producer, consumer, header codec, polling outbox relay, idempotent-consumer helper) + Kafka round-trip e2e (testcontainers Kafka) | P2 done |
| **3b** | `feat/catalog-outbox-cqrs` | catalog outbox table + write-through in write handlers + Kafka Connect/Debezium service + outbox connector → `catalog.events` + CQRS projection consumer → denormalized read model + catalog read endpoints served from the read model | 3a |
| **3c** | `feat/order-saga-events` | order polling-outbox + Saga orchestrator + `order_saga` state + convert place-order to async command/reply events; inventory gains a messaging interface (consume `inventory.commands` → replies, reusing idempotent reserve/release); new `apps/payment` STUB consumer (`payment.commands` → replies) | 3a |
| **3d** | `test/order-saga-compensation-e2e` | failure/compensation + idempotency end-to-end: forced payment failure compensates (release stock, order CANCELLED); consumer-kill mid-stream → no duplicate effects; catalog write → read model within seconds | 3b + 3c |

**Dependency order:** `3a → { 3b, 3c } → 3d`. 3b and 3c are logically independent (different services) but BOTH edit `infra/docker-compose.yml` and `architecture.md`; do them **sequentially** (or one owns the compose/arch edits) to avoid merge conflict on shared files. Recommended single-dev order: `3a → 3b → 3c → 3d`.

Detail docs: [3a](./phase-03a-messaging-infra-and-shared-lib.md) · [3b](./phase-03b-catalog-outbox-debezium-cqrs.md) · [3c](./phase-03c-order-saga-events.md) · [3d](./phase-03d-failure-compensation-idempotency-e2e.md)

## Topics (created by 3a bootstrap; `partitions=3, replication.factor=1`, keyed by aggregate id)
| Topic | Producer | Consumers | Key | Relay |
|-------|----------|-----------|-----|-------|
| `catalog.events` | catalog outbox | catalog projection (this phase); search/analytics (P4/P6) | restaurant_id / menu_item_id | **Debezium** |
| `order.events` | order outbox | (self/audit; analytics P6) | order_id | **poller** |
| `inventory.commands` | order saga | inventory consumer | order_id | poller |
| `inventory.replies` | inventory | order saga | order_id | poller (inventory outbox) |
| `payment.commands` | order saga | payment-stub consumer | order_id | poller |
| `payment.replies` | payment-stub | order saga | order_id | poller (payment outbox) |

Single partition would preserve ordering trivially; we use 3 partitions keyed by aggregate id **to actually exercise partition-key ordering** (the learning goal). RF=1 (single broker).

## Shared schemas (owned per service, shapes fixed here for consistency)

**Debezium outbox (catalog)** — column names follow the Outbox Event Router conventions:
```sql
outbox (
  id            uuid  primary key default gen_random_uuid(),  -- event id (downstream dedupe key)
  aggregatetype text  not null,   -- 'catalog' → route.by.field → topic catalog.events
  aggregateid   text  not null,   -- restaurant_id / menu_item_id → Kafka message KEY (ordering)
  type          text  not null,   -- 'MenuItemUpdated' etc → header eventType
  payload       jsonb not null,   -- event body (expand.json.payload=true → structured)
  tenant_id     uuid  not null,   -- → Kafka header for consumer tenant scoping
  correlationid text,             -- → Kafka header (audit trace)
  created_at    timestamptz not null default now()
)
```

**Polling outbox (order / inventory / payment)** — app-owned, generic across the three:
```sql
<svc>_outbox (
  id             uuid primary key default gen_random_uuid(),  -- event id
  aggregate_id   uuid not null,      -- order_id → Kafka KEY
  topic          text not null,      -- destination topic
  event_type     text not null,
  payload        jsonb not null,
  tenant_id      uuid not null,
  correlation_id text,
  created_at     timestamptz not null default now(),
  published_at   timestamptz,        -- NULL = unpublished
  attempts       int not null default 0
) ;
-- partial index for the poller's hot path:
create index on <svc>_outbox (created_at) where published_at is null;
```

**Saga state (order):**
```sql
order_saga (
  order_id       uuid primary key,
  tenant_id      uuid not null,
  state          text not null,   -- STARTED|STOCK_RESERVED|COMPLETED|COMPENSATING|CANCELLED
  correlation_id text,
  last_event_id  uuid,            -- last processed reply (idempotency)
  version        int  not null default 0,   -- optimistic lock on transitions
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
)
```

**Idempotent-consumer dedupe (every consuming service):**
```sql
processed_events (
  consumer     text not null,   -- handler/consumer-group name
  event_id     uuid not null,   -- event id from the header
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
)
```
Consumer inserts `(consumer, event_id)` INSIDE the same tx as its side effect; a `23505` means already-processed → skip. Effect + dedupe marker commit atomically → exactly-once *effect*.

## `libs/shared/messaging` public surface (built in 3a)
- `MessagingModule.forRoot({ clientId, brokers })` — registers the Kafka client + idempotent producer.
- `KAFKA_PRODUCER` token + `MessageProducer` — `publish(record)` / `publishBatch(records)` where `record = { topic, key, headers, value }`.
- `EventEnvelope` type `{ eventId, eventType, aggregateId, tenantId, correlationId, occurredAt, payload }` + `encodeHeaders` / `decodeHeaders` (map envelope ↔ Kafka headers).
- `OUTBOX_PORT` + `OutboxRelay` — polling publisher: `fetchUnpublished(limit)` / `markPublished(ids)` over the app's outbox table (`FOR UPDATE SKIP LOCKED`); the relay loop, backoff, and produce live in the lib, the table adapter in each service's infra.
- `PROCESSED_EVENT_STORE` + `IdempotentConsumer.runOnce(consumer, eventId, tx, work)` — dedupe helper.
- Consumer subscribe helper: manual offset commit (autoCommit off), runs each message inside `TenantContextPort.run(...)` decoded from headers, then the handler, then commit.

Lib tags `scope:shared, type:util`; imports the chosen Kafka client + `shared-tenancy` (shared→shared allowed). Never imports app code (cruiser-enforced).

## Requirements
**Functional**: async order Saga (reserve → charge → confirm) with reverse compensation on any failure; Outbox in catalog (Debezium) + order/inventory/payment (poller); Debezium publishes `catalog.events`; catalog read model serves list/get from the denormalized store.
**Non-functional**: exactly-once *effect* via Outbox + idempotent consumers; ordered per-key (order_id / aggregate id) via Kafka partition key; consumer manual-commit + basic retry; poison handling stub (full DLQ in P5). Single Kafka broker, heap-capped, fits 16GB alongside `core`(+`auth`).

## Success criteria
- Order confirmed end-to-end through events (no inline gRPC reserve in the happy path; place-order returns `PENDING`, resolves to `CONFIRMED` async).
- Forced payment failure compensates: stock released, order `CANCELLED`, no partial state.
- Catalog write appears in read model within seconds via Outbox → Debezium → Kafka → projection.
- Killing a consumer mid-stream → on restart, no duplicate side-effects (idempotent).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Kafka + Connect RAM on 16GB | M×H | Single-broker KRaft, heap `-Xmx512m`; Connect heap-capped; only `core`+`messaging`(+`auth`) up. RAM budget verified in 3a. |
| Saga compensation gaps | M×H | Enumerate every failure branch (3c); explicit state table; test per branch (3d). |
| Duplicate event processing | M×M | `processed_events` dedupe keyed by event id, in the effect's tx. |
| Debezium connector misconfig | M×M | Version connector JSON in `infra/debezium/`; 3b e2e asserts a known change propagates. |
| Ordering across partitions | M×M | Key by aggregate id (order_id / restaurant_id); documented invariant. |
| Async contract break for clients | M×M | Document `PENDING`→poll contract; gateway/OpenAPI updated; e2e polls to terminal state. |
| Stuck saga (no reply) | L×M | `status=PENDING` / stale-saga sweep note; full timeout/DLQ deferred to P5. Resolves the P2 reconciler backlog item. |

## Security considerations
- Event payloads carry `tenant_id`; consumers re-establish tenant scope via `TenantContextPort.run(...)` from the header and enforce it. No PII beyond necessity in events.
- Kafka + Connect on the internal network only (never published via Nginx).
- Correlation id + actor propagated in Kafka headers for audit trace continuity.
- Outbox rows are the source of truth for emission; never emit outside a tx.

## Next steps
Unblocks P4 (search consumes `catalog.events` into ES; delivery real-time), P5 (payment-stub → Temporal workflow + DLQ; saga timeouts), P6 (analytics/review consume order/review events). Closes the P2 backlog item: the Kafka Saga + Outbox reconciles/sweeps stranded `PENDING` orders.
</content>
</invoke>
