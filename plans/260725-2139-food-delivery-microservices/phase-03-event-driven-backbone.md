# Phase 3 — Event-driven backbone (Kafka, Outbox, Debezium, Saga, CQRS)

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P0 (core distributed-systems learning)
- **Status**: Not started
- **Brief**: Introduce Kafka. Add Outbox to catalog + order for exactly-once emission. Debezium CDC tails catalog. Convert the synchronous order flow into an orchestrated Saga (order→inventory→payment-stub) with compensation. Build catalog CQRS read model. This is the phase that turns coupled services into an event-driven system.

## Key insights
- Outbox = write domain change + event row in ONE Postgres tx → Debezium/relay publishes → no dual-write loss. Teaches the canonical reliability pattern.
- Saga orchestration (central coordinator in order) chosen over choreography for visibility/learning; document choreography as alternative.
- CQRS read model: catalog write model (normalized) vs read model (denormalized, Redis/read table) updated from events — teaches read/write separation before ES in P4.
- Payment is a STUB here (returns ok/fail); real Temporal workflow arrives P5. Keeps phase focused.

## Requirements
**Functional**: order Saga (reserve→charge→confirm) with reverse compensation on any failure; Outbox in catalog + order; Debezium publishes `catalog.events`; catalog read model serves list/get from denormalized store.
**Non-functional**: exactly-once semantics via Outbox + idempotent consumers; ordered per-key (order_id / restaurant_id) via Kafka partition key; consumer retries + poison handling stub (full DLQ in P5).

## Architecture
- `messaging` compose profile: Kafka 4.0 (KRaft), Kafka Connect + Debezium 3.x.
- Topics: `catalog.events`, `order.events`, `inventory.commands`, `payment.commands`, and reply topics.
- Outbox: `outbox(id, aggregate, type, payload, published_at)`; relay = Debezium on outbox table (catalog) or Nest polling publisher (order) — implement Debezium for catalog, poller for order to learn both.
- Saga orchestrator in order: persists saga state; emits commands; consumes replies; drives state machine; compensations (release stock, void charge).
- Catalog CQRS: command side writes Postgres + outbox; projection consumer builds read model (denormalized table or Redis) used by read endpoints.

## Related code files (to create)
- `libs/shared/messaging/*` — Kafka producer/consumer wrappers, Outbox writer, idempotent-consumer helper, correlation-ID headers
- `apps/order/saga/*` — orchestrator, saga-state entity, command/reply handlers, compensations
- `apps/catalog/outbox/*` + `apps/catalog/projection/*` (read model), read endpoints switched to read model
- `apps/inventory/*` — consume `inventory.commands`, emit replies (reserve/release via events now)
- `apps/payment/*` — STUB consumer for `payment.commands` (ok/fail), emits reply
- `infra/debezium/*` connector config (catalog outbox); Kafka Connect service in compose

## Implementation steps
1. Add `messaging` profile (Kafka KRaft, Kafka Connect+Debezium). Verify single-broker fits 16GB.
2. Build `shared/messaging`: typed producer/consumer, Outbox writer, idempotent-consumer (dedupe by event id), header propagation.
3. Catalog: add outbox table + write-through; register Debezium connector → `catalog.events`.
4. Catalog CQRS: projection consumer builds read model; point read endpoints at it.
5. Order: add outbox (polling publisher); build Saga orchestrator + saga-state; convert reserve/charge to command/reply events; implement compensations.
6. Inventory + payment-stub: convert to event consumers emitting replies.
7. E2E: happy path order confirmed via events; inject payment-stub failure → compensation releases stock, order CANCELLED; catalog update propagates to read model.

## Todo
- [ ] Kafka + Connect + Debezium up under `messaging` profile
- [ ] shared/messaging (producer/consumer/outbox/idempotent-consumer)
- [ ] catalog outbox + Debezium connector → catalog.events
- [ ] catalog CQRS projection + read endpoints on read model
- [ ] order outbox (poller) + Saga orchestrator + compensations
- [ ] inventory + payment-stub as event consumers
- [ ] E2E: happy Saga + failure compensation + catalog projection

## Success criteria
- Order confirmed end-to-end through events (no inline gRPC reserve/charge in happy path).
- Forced payment failure compensates: stock released, order CANCELLED, no partial state.
- Catalog write appears in read model within seconds via Outbox→Debezium→Kafka→projection.
- Killing a consumer mid-stream → on restart, no duplicate side-effects (idempotent).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Kafka RAM on 16GB | M×H | Single broker KRaft, low heap (`-Xmx512m`), only `core`+`messaging` up |
| Saga compensation gaps | M×H | Enumerate every failure branch; state table; tests per branch |
| Duplicate event processing | M×M | Idempotent consumers keyed by event id |
| Debezium connector misconfig | M×M | Version connector JSON; test with a known change |
| Ordering across partitions | M×M | Partition by aggregate id (order_id/restaurant_id) |

## Security considerations
- Event payloads carry tenant_id; consumers enforce tenant scope. No PII beyond necessity in events.
- Kafka internal network only. Correlation ID + `sub` in event headers for audit trace.
- Outbox rows treated as source of truth for emission; never emit outside a tx.

## Next steps
Unblocks P4 (search consumes catalog.events into ES; delivery real-time), P5 (payment-stub → Temporal workflow + DLQ), P6 (analytics/review consume order/review events).
