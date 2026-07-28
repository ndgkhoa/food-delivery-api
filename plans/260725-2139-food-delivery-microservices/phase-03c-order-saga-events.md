# Slice 3c — Order Saga (polling outbox) + inventory/payment event consumers

Context: [phase-03.md](./phase-03-event-driven-backbone.md) · [phase-02.md](./phase-02-order-core-inventory.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)
Report: [researcher-260728-phase-03-event-driven-stack.md](./reports/researcher-260728-phase-03-event-driven-stack.md)

## Overview
- **Priority**: P0
- **Status**: Not started
- **Branch (example)**: `feat/order-saga-events`
- **Brief**: Replace P2's inline synchronous reserve/charge with an **orchestrated Saga** in `order`, driven by Kafka command/reply events, reliable via a **polling outbox** (contrast to 3b's Debezium relay). Place-order becomes async: persist `PENDING` + saga `STARTED` + first command in one tx, return immediately. Inventory gains a **messaging interface** (consume `inventory.commands`, emit replies) reusing its already-idempotent reserve/release. New `apps/payment` STUB consumes `payment.commands`, emits deterministic ok/fail replies.

## Key insights / decisions
- **Relay = app polling publisher** (`OutboxRelay` from 3a) — order/inventory/payment each own a `<svc>_outbox` table + relay. Teaches the non-CDC outbox.
- **Reuse, don't rewrite** inventory's reserve/release application handlers — they are already idempotent by `orderId` (P2 hardening: atomic conditional UPDATE, partial-unique ACTIVE index). We add only a new **interface/messaging adapter**; domain/application untouched (hexagonal payoff).
- Order stops calling inventory over gRPC → **remove** `InventoryGrpcAdapter` + `INVENTORY_GATEWAY_PORT` usage from the place-order path (knip would flag it otherwise). **Catalog validate stays gRPC** — menu validation is a synchronous read (a query), not a saga step; keep it inline before starting the saga.
- **Async API contract change**: `POST /orders` returns `202`-style `PENDING`; client polls `GET /orders/:id` to `CONFIRMED`/`CANCELLED`. Document in OpenAPI + gateway.
- Payment stub is **deterministic**: fails when order `total_cents === PAYMENT_STUB_FAIL_AT_CENTS` (env). Lets 3d trigger compensation reliably without randomness. Real Temporal + DLQ = P5.
- Closes the P2 backlog item: the saga owns the order lifecycle; a stale-saga sweep reconciles stranded holds (basic here; full timeout/DLQ P5).

## Saga state machine (orchestrator in `order`)
```
POST /orders ─▶ tx{ insert order PENDING · insert order_saga STARTED · outbox: inventory.commands ReserveStock }  ─▶ 202 PENDING
                                              │ (poller publishes ReserveStock, key=order_id)
inventory consumer: runOnce(dedupe) → reserve(orderId,items) → outbox reply:
      StockReserved            ─▶ saga STARTED→STOCK_RESERVED → outbox: payment.commands ChargePayment
      StockReservationFailed   ─▶ saga STARTED→CANCELLED       → order CANCELLED
payment-stub consumer: runOnce → charge():
      PaymentSucceeded         ─▶ saga STOCK_RESERVED→COMPLETED → order CONFIRMED
      PaymentFailed            ─▶ saga STOCK_RESERVED→COMPENSATING → outbox: inventory.commands ReleaseStock
inventory consumer: release(orderId) → outbox reply StockReleased ─▶ saga COMPENSATING→CANCELLED → order CANCELLED
```
Every saga transition is **optimistic-locked** (`order_saga.version`) and **idempotent** (`last_event_id` + `processed_events`), so a redelivered reply is a no-op. Order status transitions reuse the P2 state machine (PENDING→RESERVED→CONFIRMED/CANCELLED); "RESERVED" maps to STOCK_RESERVED, "CONFIRMED" on payment success.

## Requirements
**Functional**: async place-order; saga drives reserve→charge→confirm; compensation releases stock on payment failure and on stock-fail cancels; inventory + payment consume commands and emit replies; all via outbox+Kafka.
**Non-functional**: exactly-once effect (dedupe by event id in effect tx); per-order ordering (key=order_id); optimistic-locked saga transitions; outbox poller uses `FOR UPDATE SKIP LOCKED`; deterministic payment stub for testability.

## Related code files
**Create — order:**
- migrations: `*-create-order-outbox.ts` (`order_outbox`), `*-create-order-saga.ts` (`order_saga`), `*-create-processed-events.ts`.
- `domain/saga/order-saga.ts` (state model + transition invariants) · `order-saga.repository.ts` (port).
- `domain/shared/outbox.port.ts` (`OUTBOX_PORT`) · infra `typeorm-outbox.adapter.ts` + `typeorm-order-saga.repository.ts` + `typeorm-processed-event.store.ts`.
- `application/saga/handle-inventory-reply.handler.ts` · `handle-payment-reply.handler.ts` · `start-order-saga` (folded into PlaceOrder).
- `interface/messaging/inventory-reply.consumer.ts` · `payment-reply.consumer.ts` · `order-outbox-relay.provider.ts` (starts `OutboxRelay`).
- event factories → `EventEnvelope` for ReserveStock/ReleaseStock/ChargePayment commands.

**Create — inventory:**
- `interface/messaging/inventory-command.consumer.ts` (consume `inventory.commands` → call existing Reserve/Release handlers → outbox reply).
- migrations: `inventory_outbox`, `processed_events`; infra outbox adapter + relay provider + reply event factory.

**Create — payment (new `apps/payment` STUB, hexagonal-lite):**
- `apps/payment/` app (main/app.module/config), `interface/messaging/payment-command.consumer.ts`, deterministic charge rule, `payment_outbox` + `processed_events`, outbox adapter + relay, reply factory. Owns `payments`/`payment_attempts` later (P5) — here minimal.
- `apps/payment-e2e/` scaffold (or fold saga e2e into `order-e2e`).

**Modify:**
- `apps/order/src/application/order/commands/place-order.handler.ts` — replace `driveReservation` (inline gRPC reserve) with: in one tx insert order PENDING + saga STARTED + outbox ReserveStock command; return PENDING. Keep catalog gRPC validate + idempotency-claim-in-tx.
- `apps/order/src/app.module.ts` — add `MessagingModule.forRoot`, saga repo, outbox adapter, consumers, relay; **remove** `INVENTORY_GATEWAY_PORT`/`InventoryGrpcAdapter` wiring from the place path.
- `apps/inventory/src/app.module.ts` — add messaging module + command consumer + outbox relay (keep gRPC server; unused-by-order but harmless — or drop gRPC reserve if knip flags; decide at impl).
- `apps/gateway/*` — `OrderProxyController` documents async `PENDING`; add `PAYMENT` nothing public. OpenAPI updated.
- `infra/docker-compose.yml` — add `payment` app service; ensure order/inventory/payment get `KAFKA_BROKERS`.

## Schemas (see phase-03.md for full DDL): `order_outbox`, `inventory_outbox`, `payment_outbox` (generic polling shape); `order_saga`; `processed_events` per service.

## Event payloads (JSON `value`, headers carry ids/tenant/correlation)
- `ReserveStock` `{ orderId, items:[{itemId,qty}] }` · `ReleaseStock` `{ orderId }`
- `StockReserved` `{ orderId }` · `StockReservationFailed` `{ orderId, reason }` · `StockReleased` `{ orderId }`
- `ChargePayment` `{ orderId, totalCents }` · `PaymentSucceeded` `{ orderId }` · `PaymentFailed` `{ orderId, reason }`

## Implementation steps
1. Order migrations: `order_outbox`, `order_saga`, `processed_events`.
2. Order domain saga model + repo port + TypeORM adapter (optimistic-locked transitions).
3. Rewrite `PlaceOrderHandler`: one-tx {claim key · insert PENDING order · insert saga STARTED · outbox ReserveStock}; return PENDING. Remove inline reserve.
4. Wire order `OutboxRelay` provider (starts on bootstrap) + `MessagingModule`.
5. Order reply consumers (`inventory.replies`, `payment.replies`) → idempotent saga transition handlers → emit next command via outbox or finalize order status.
6. Inventory: messaging command consumer → existing Reserve/Release handlers (idempotent) → outbox reply; add inventory outbox + relay.
7. Payment stub app: command consumer → deterministic charge (`fail if totalCents===PAYMENT_STUB_FAIL_AT_CENTS`) → outbox reply; outbox + relay.
8. Compose: add `payment` service; broker env for order/inventory/payment; gateway async doc + OpenAPI.
9. **Integration/e2e** (happy path only here; failure/idempotency in 3d): place order → poll → CONFIRMED; stock decremented; saga COMPLETED. Concurrency (100 orders on stock=10) → 10 CONFIRMED, 90 CANCELLED via StockReservationFailed, zero oversell.
10. Update plan todos/status BEFORE push.

## Todo
- [ ] order migrations (order_outbox, order_saga, processed_events)
- [ ] order saga domain model + repo (optimistic lock)
- [ ] PlaceOrder rewritten to async (persist PENDING+saga+outbox in one tx); inline gRPC reserve removed
- [ ] order OutboxRelay + MessagingModule wired
- [ ] order reply consumers → idempotent saga transitions + next-command emission
- [ ] inventory messaging command consumer + outbox reply (reuses Reserve/Release)
- [ ] payment STUB app (consumer + deterministic charge + outbox reply)
- [ ] compose: payment service + broker env; gateway async contract + OpenAPI
- [ ] happy-path + concurrency e2e green
- [ ] biome/cruiser/knip clean; plan updated before push

## Success criteria
- Place order returns PENDING; polls to CONFIRMED via events; no inline gRPC reserve in the path.
- 100 concurrent orders on stock=10 → 10 CONFIRMED, 90 CANCELLED, zero oversell, all async.
- Redelivered reply causes no duplicate transition (idempotent saga) — asserted here, hammered in 3d.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Saga compensation branch gaps | M×H | Explicit state table (above); a handler per reply; 3d tests every branch |
| Duplicate reply → double transition | M×M | `processed_events` dedupe + `order_saga.version` optimistic lock; both in effect tx |
| Async contract breaks existing clients/e2e | M×M | Update OpenAPI + gateway; e2e polls to terminal state; documented |
| Removing gRPC reserve breaks P2 e2e | M×M | Re-point/rewrite order-e2e for async; inventory keeps gRPC for now (or drop if knip flags) |
| Stranded saga (no reply) | L×M | Stale-saga sweep (status=PENDING worklist) note; full timeout/DLQ P5 |
| Poller double-publish on multi-instance | L×M | `FOR UPDATE SKIP LOCKED` + `published_at` guard; producer idempotent |

## Security considerations
- Commands/replies carry `tenant_id`; consumers reopen tenant scope + enforce it; order ownership unchanged (owner/admin).
- Payment stub handles no real card data; `totalCents` only. Internal topics only.
- Outbox = sole emission source of truth; no direct publishes; correlation id propagated for audit trace.

## Next steps
3d exercises failure/compensation + idempotency e2e. P5 swaps payment stub for Temporal workflow + DLQ + saga timeouts. P6 consumes `order.events`.
</content>
