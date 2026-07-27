# Phase 2 — Order core + Inventory (gRPC, no events yet)

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P0
- **Status**: 🔨 In progress
- **Slicing**: **2a** — gRPC contracts (`.proto` in `shared/contracts`) + `inventory` service (stock/reservations, reserve/release with Redis lock + tx, gRPC server) + catalog gRPC server (GetMenuItems) + `shared/locking`. **2b** — `order` service (state machine, create-order flow over gRPC, idempotency, optimistic lock) + gRPC identity/tenant/correlation metadata propagation + place/cancel/concurrency/idempotency e2e.
- **Brief**: Build the order lifecycle as an explicit state machine with idempotency, optimistic + distributed locking. Split stock into `inventory` service. Introduce gRPC for east-west calls (order↔catalog↔inventory). Still synchronous — no Kafka. This exposes WHY events are needed (P3).

## Key insights
- Deliberately synchronous first: place-order calls inventory.reserve over gRPC inline. It works but couples services + blocks on failures — the pain that motivates the Saga in P3.
- Order does NOT own stock. Inventory owns reserve/release with its own consistency.
- Idempotency key on create-order prevents double-charge on client retry. Optimistic lock (version col) guards concurrent order edits; Redis distributed lock guards the reserve critical section.

## Requirements
**Functional**: create order (validate menu via catalog gRPC), reserve stock (inventory gRPC), state machine PENDING→RESERVED→CONFIRMED / CANCELLED; cancel releases stock; idempotent create.
**Non-functional**: reserve is atomic (no oversell under concurrency); optimistic-lock conflict → 409 retry; distributed lock TTL-bounded; identity + tenant propagated over gRPC metadata.

## Architecture
- gRPC contracts in `shared/contracts` (`.proto`): `CatalogService.GetMenuItems`, `InventoryService.Reserve/Release`.
- Order state machine: explicit transitions table; illegal transition rejected. Persist state + version.
- Inventory: `stock(item_id, available)`, `reservations(order_id, item_id, qty, status)`; reserve decrements available in a tx guarded by Redis lock keyed per item.
- Idempotency: `idempotency_keys(key, order_id, response)` — replay returns stored response.

## Related code files (to create)
- `apps/order/*` — controller (REST via gateway), state-machine module, gRPC client to catalog+inventory, idempotency store
- `apps/inventory/*` — gRPC server, reserve/release service, stock+reservation entities
- `libs/shared/contracts/*.proto` (catalog, inventory) + generated stubs
- `libs/shared/messaging` NOT yet (P3); `libs/shared/locking` (Redis lock helper)
- Migrations: `orders`, `order_items`, `idempotency_keys` (order DB); `stock`, `reservations` (inventory DB)

## Implementation steps
1. Define `.proto` for catalog + inventory; generate stubs into `shared/contracts`.
2. Add gRPC server to catalog (`GetMenuItems`) — extends P0 catalog.
3. Build inventory service: entities, reserve/release with Redis distributed lock + DB tx; gRPC server.
4. Build order: state machine (transition guard), create-order flow (catalog validate → inventory reserve), optimistic-lock version col.
5. Idempotency middleware on create-order (Redis + persisted key).
6. Propagate identity/tenant/correlation-ID via gRPC metadata interceptor (shared).
7. E2E: place order → stock decremented + order RESERVED; concurrent orders don't oversell; duplicate idempotency key returns same order; cancel releases stock.

## Todo
**Slice 2a — contracts + inventory + catalog gRPC (✅ done, PR pending):**
- [x] catalog + inventory `.proto` in `shared/contracts` + hand-written contract types; shared `PROTO_LOADER_OPTIONS` (camelCase + empty repeated → `[]`, not `undefined`) used by every server + client
- [x] catalog gRPC server (`GetMenuItems`) — hybrid HTTP+gRPC extending P0 catalog; tenant-scoped; e2e proves cross-tenant returns `[]`
- [x] inventory service (hexagonal): stock/reservations + reserve/release + Redis distributed lock + DB tx + gRPC server
- [x] `libs/shared/locking` (Redis lock helper: fencing token + sorted multi-key + Lua compare-and-del + **all-or-nothing acquire** with jittered backoff so a contended reserve serialises without hold-and-wait; fence-key TTL; release-failure logging)
- [x] E2E proof (real Postgres + Redis): 50 concurrent reserves on stock=10 → exactly 10 succeed, 40 out-of-stock, available=0, zero oversell; duplicate-item-in-one-request also cannot oversell (qty summed)

**Review hardening (code-reviewer round 1 — all C/H/M/L addressed):**
- [x] No-oversell backstop moved to the DB: atomic conditional `UPDATE ... WHERE available >= qty` (not read-modify-write) — correctness holds even if the Redis lock is lost. Duplicate line items summed per item; items sorted for deadlock-free row-lock order.
- [x] DB-enforced idempotency: partial unique index `reservations(tenant_id, order_id, item_id) WHERE status='ACTIVE'`; replay must carry identical items/qty.
- [x] gRPC status mapping: contention→ABORTED (retryable), invalid request→INVALID_ARGUMENT, idempotency conflict→ALREADY_EXISTS, faults→INTERNAL (logged, no leak).
- [x] Release path hardened symmetrically (review round 2, N1): ACTIVE→RELEASED is an atomic conditional UPDATE gate so a concurrent double-release returns stock exactly once (no phantom units) — e2e proves it. All 10 round-1 findings verified closed.

**Slice 2b — order + flow:**
- [x] order state machine (PENDING→RESERVED→CONFIRMED/CANCELLED) + optimistic lock (hexagonal `apps/order`: domain/application/infrastructure/interface, conditional `UPDATE ... WHERE version` guard)
- [x] create-order flow calls catalog + inventory over gRPC (`PlaceOrderHandler`: validate menu → claim idempotency key → reserve → persist RESERVED/CANCELLED; compensating release on post-reserve persist failure)
- [x] idempotency key store (per user+tenant) — composite PK `(tenant_id, user_id, key)`, real 23505 on conflict
- [x] gRPC metadata propagation (tenant via `x-tenant-id`; `CatalogGrpcAdapter`/`InventoryGrpcAdapter` + `retryOnAborted`)
- [x] E2E green (real Postgres×2 + Redis + real inventory gRPC + order over genuine gRPC): place→RESERVED + stock decremented, cancel→CANCELLED + stock released, idempotency (duplicate key → one order), **100-concurrent single-item on stock=10 → exactly 10 RESERVED, rest InsufficientStock, available=0, zero oversell** end-to-end. Suites run serially (each boots its own stack on a fixed inventory port). cancel/confirm return 200.
- [x] gateway `OrderProxyController` + `ORDER_SERVICE_URL` wiring

## Success criteria
- Placing an order reserves exactly the ordered qty; 100 concurrent orders on 10 stock → 10 succeed, 90 rejected, zero oversell.
- Duplicate create with same idempotency key → identical response, one order.
- Cancel returns stock; illegal state transition → 409/422.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Oversell under concurrency | M×H | Redis lock + DB tx + row check; concurrency test in CI |
| Distributed lock held on crash | M×M | Short TTL + fencing token; reserve idempotent |
| Sync gRPC coupling cascades failures | H×M | Accept for now; documented as motivation for P3 Saga |
| Deadlock ordering multi-item reserve | M×M | Lock items in deterministic (sorted) order |

## Security considerations
- Order ownership = token `sub`; users can only act on own orders (except admin). Tenant-scoped.
- Validate menu item belongs to tenant before reserve. gRPC internal-only (not exposed via Nginx).
- Idempotency keys scoped per user+tenant to prevent cross-user replay.

## Next steps
Unblocks P3: replace inline gRPC reserve/charge with Kafka Saga + Outbox; add payment step. Order state machine becomes Saga-driven.
