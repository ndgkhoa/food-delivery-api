# Slice 4b — Delivery service (WebSocket live location + Redis GEO + order.events assign)

Context: [phase-04.md](./phase-04-search-realtime-media.md) · [phase-03c.md](./phase-03c-order-saga-events.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P1 — second P4 track (independent of 4a search; 4c media is the third).
- **Status**: ✅ Verified — full delivery-e2e GREEN (4/4) on live compose (`core`+`messaging` + delivery on host): driver WS location → Redis GEO → nearby query; `order.events` OrderConfirmed → nearest-driver assignment (idempotent under redelivery); customer WS receives a live driver-location fan-out; tenant isolation (tenant-A driver invisible to tenant B). order emits OrderConfirmed/OrderCancelled to `order.events` atomically. Unit: delivery 34, order 59, gateway 17; tsc/biome/dependency-cruiser/knip clean. **Real bug found+fixed in verify**: WS auth ran in async `handleConnection` (post-connect), so a client emitting immediately after `connect` raced the unfinished JWKS verify and its message was dropped — moved auth into a Socket.IO handshake middleware (`server.use`) so identity is set before the socket connects. E2e harness hardened: serial suites (`maxWorkers:1`, shared fixed JWKS port) + a pinned shared test keyset (the service caches JWKS by kid; per-suite random keys failed all suites after the first) — added an optional fixed-key path to `createTestKeySet`.

**Adversarial review: WS auth + tenant isolation verified airtight, order.events emission atomic + exactly-once.** Fixes applied (re-verified e2e 4/4 green): **C1 (Critical)** — one-order-per-driver was a check-then-set race (two orders confirmed concurrently could both grab the same nearest free driver → double-booking); replaced the app-side busy-filter + `HSETNX` with an atomic Redis **Lua claim** that binds the first non-busy candidate in one operation (enforces one-driver-per-order AND one-order-per-driver); also returns a `created` flag so a redelivered `OrderConfirmed` no longer re-broadcasts `assigned` (**M2**). **H1** — a driver disconnect now `ZREM`s it from the GEO roster (a crashed/offline driver stops being assignable/searchable), and `OrderCancelled` now releases the assignment (Lua `unassign`, clearing the busy flag when the driver holds no other orders) so the busy roster can't leak. Deferred (documented): silent-crash presence via heartbeat/TTL → P5; full order-ownership on customer room-join (**M1**, intra-tenant — a basic assignment-exists check now) → needs the order service; `nearby` role-scoping + WS token-in-query/CORS hardening (**L1–L3**) → P8 WS ingress. Review report: `../reports/code-reviewer-260728-2311-slice-4b-delivery-realtime-red-team-review-report.md`.
- **Brief**: New `apps/delivery` service: drivers push live location over **WebSocket** → stored in **Redis GEO**; customers subscribe to their order's driver-location channel and see it move; a **nearby-driver** query answers geo-radius lookups; and the service **consumes `order.events`** so that when an order is CONFIRMED it assigns the nearest available driver. Lights up the `order.events` topic (planned in P3, un-emitted until now) via a tiny order change.

## Key decisions (versions verified live 2026-07-28)
- **WS = Socket.IO** via `@nestjs/websockets@11.1.28` + `@nestjs/platform-socket.io@11.1.28`, scaled with `@socket.io/redis-adapter@8.3.0` (pub/sub fan-out across instances). Client for e2e: `socket.io-client@4.8.3`.
- **Redis** = the existing `core`-profile `redis:8.8.0-alpine` via `ioredis@^5.11.1` (already a dep — `shared-locking` uses it). `GEOADD`/`GEOSEARCH` for driver positions.
- **order.events emission**: order's polling outbox (3c) gains ONE more emission — `OrderConfirmed` (+ `OrderCancelled`) to topic `order.events`, keyed by orderId, when the saga finalizes. Payload `{ orderId, userId, status, totalCents }` (+ tenant/correlation via headers). This is the planned P3 topic; delivery + P6 analytics consume it. Small, in the existing outbox+relay — no new infra.
- **gRPC deferred (YAGNI)**: the plan lists a delivery gRPC server (server-to-server assign + location stream). No consumer needs it this slice — assignment is event-driven (order.events) and location is WS. Defer gRPC to when a caller exists (P5/P6), documented.
- **JWT on WS connect**: authenticate the Socket.IO handshake (reuse the gateway-verified identity model / `shared-tenancy` + shared-jwt); authorize `driver` vs `customer` channels; rate-limit location pushes. Tenant-scoped everywhere.

## Requirements
**Functional**: a driver client connects over WS (authenticated, role `driver`) and emits `location {lat,lng}` → `GEOADD` (tenant-scoped key); a customer client subscribes to `order:{orderId}` and receives the assigned driver's location updates; `GET /delivery/orders/:orderId/nearby-drivers?radius=` returns nearby drivers via `GEOSEARCH`; on `OrderConfirmed` the service assigns the nearest available driver to the order and broadcasts the assignment.
**Non-functional**: WS scales via the Redis adapter (stateless handlers); location pushes rate-limited + validated (lat/lng bounds); assignment idempotent (dedupe by order id — one driver per order); tenant isolation on every channel/query; Redis GEO keys tenant-prefixed.

## Architecture / data flow
```
driver WS ──emit location{lat,lng}──▶ DeliveryGateway ──▶ Redis GEOADD geo:{tenant}:drivers (driverId)
customer WS ──join order:{orderId}──▶ receives driver-location broadcasts for the assigned driver

order.events (Kafka, NEW) ──OrderConfirmed──▶ delivery consumer
        └─▶ GEOSEARCH nearest available driver ─▶ assign(orderId, driverId) [Redis hash, idempotent]
            └─▶ broadcast 'assigned' to order:{orderId}; driver location updates thereafter fan out to that room

GET /delivery/orders/:id/nearby-drivers ─▶ GEOSEARCH radius ─▶ [{driverId, distance}]
```

## Related code files (to create)
**order (tiny):**
- `apps/order/src/application/saga/*` — when the saga reaches COMPLETED (order CONFIRMED) / CANCELLED, append an `OrderConfirmed` / `OrderCancelled` outbox row to topic `order.events` (reuse the existing `OUTBOX_WRITER` + relay). Add the event factory + wire in `handle-payment-reply` (confirmed) / `handle-inventory-reply` (cancelled). Unit-test the emission.
- No migration (order_outbox already exists).

**delivery (`apps/delivery/` — new):**
- Nx app: project.json (`scope:delivery, type:app`), tsconfig*, jest, webpack, main.ts (HTTP + WS on PORT 3005, prefix `api/v1`, pino, shutdown hooks; Socket.IO with `@socket.io/redis-adapter`).
- `config/delivery-env-schema.ts` — PORT 3005, REDIS_URL, KAFKA_BROKERS, KAFKA_CLIENT_ID=delivery, DRIVER_LOCATION_RATE_LIMIT, NEARBY_RADIUS_M default.
- `infrastructure/redis/*` — ioredis client module; `RedisDriverLocationStore` (GEOADD/GEOSEARCH, tenant-prefixed keys) + `RedisAssignmentStore` (hash `assign:{tenant}` orderId→driverId, `HSETNX` for idempotent one-driver-per-order).
- `domain/*` — ports (`DRIVER_LOCATION_STORE`, `ASSIGNMENT_STORE`), models (Location, Assignment, NearbyDriver), pure assign-nearest selection.
- `interface/ws/delivery.gateway.ts` — Socket.IO gateway: JWT-authenticated handshake, `driver` emits `location`, `customer` joins `order:{orderId}`; validates lat/lng + rate-limits; broadcasts location to the order room.
- `interface/messaging/order-events.consumer.ts` — consume `order.events`; on OrderConfirmed → assign nearest available driver (GEOSEARCH) → store (idempotent) → broadcast `assigned`.
- `interface/http/delivery.controller.ts` + DTOs — `GET /delivery/orders/:orderId/nearby-drivers`, `GET /delivery/orders/:orderId/assignment`.
- `application/*` — assign-driver handler, nearby-drivers query, location-update handler.
- `apps/delivery-e2e/` — socket.io-client + ioredis + a Kafka producer to drive `order.events`; compose-based.

**infra / root:**
- `package.json` — add socket.io/adapter/nestjs-ws deps; add `delivery` to `dev`. Redis already in `core`; no new compose service (host process).
- `apps/gateway/*` — proxy `/api/v1/delivery/*` HTTP (nearby/assignment). WS goes direct to :3005 for dev (document; Nginx WS upgrade is P8). OpenAPI note.
- `.env.example` — delivery keys.

## Implementation steps
1. order: add `OrderConfirmed`/`OrderCancelled` event factory + emit to `order.events` in the saga finalize handlers (in the same tx as the status transition + existing outbox). Unit test.
2. Scaffold `apps/delivery` (HTTP+WS Nest app). ioredis module (reuse the `core` Redis).
3. Redis GEO store (GEOADD/GEOSEARCH, tenant-prefixed) + assignment store (HSETNX idempotent). Pure nearest-selection unit-tested.
4. WS gateway: authenticated handshake (JWT → tenant/role), `location` handler (validate+rate-limit → GEOADD → broadcast to order room), customer `join order:{id}`. Redis adapter for scale.
5. order.events consumer: OrderConfirmed → assign nearest available driver (idempotent) → broadcast `assigned`.
6. HTTP nearby-drivers + assignment endpoints (tenant-scoped) + gateway proxy.
7. deps + `dev` script + `.env.example`.
8. **E2E** (compose `core`+`messaging`; order + delivery on host): driver WS connects + emits location → nearby query returns it; produce an `OrderConfirmed` to `order.events` (or place a real order end-to-end) → driver assigned; customer WS subscribed to the order room receives a subsequent location update. Tenant isolation (a driver in tenant A never appears in tenant B's nearby/assignment).
9. Update plan todos/status BEFORE push.

## Todo
- [x] order emits `OrderConfirmed`/`OrderCancelled` to `order.events` (existing outbox); unit-tested
- [x] `apps/delivery` scaffolded (HTTP+WS, ioredis module, Redis adapter)
- [x] Redis GEO driver-location store + idempotent assignment store
- [x] WS gateway: JWT handshake auth + `location` (validate+rate-limit) + customer order-room subscribe
- [x] `order.events` consumer → assign nearest available driver (idempotent) → broadcast
- [x] nearby-drivers + assignment HTTP endpoints (tenant-scoped) via gateway
- [x] E2E specs written: WS location → GEO → nearby; OrderConfirmed → assign; customer receives live update; tenant isolation (compose-run by orchestrator)
- [x] biome/cruiser/knip clean; unit tests green; plan updated before push

## Success criteria
- A driver pushing location over WS is discoverable by the nearby-driver query within the radius; a second client (customer) subscribed to the order sees the driver position change live.
- An order reaching CONFIRMED assigns exactly one nearest available driver (idempotent under redelivery); assignment is queryable.
- Tenant isolation across WS channels, GEO keys, and assignment. WS scales via the Redis adapter.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| WS auth bypass (unauthenticated location push / cross-tenant) | M×H | JWT verified on handshake; tenant+role from the verified identity, never client-supplied; per-tenant GEO keys + room names |
| WS e2e flakiness (async fan-out timing) | M×M | Bounded waits + clear diagnostics; socket.io-client acks; deterministic order-event injection |
| Assignment double-driver under redelivery | M×M | `HSETNX` one-driver-per-order (idempotent); order.events keyed by orderId (ordered) |
| Redis GEO staleness (driver went offline) | L×M | Location TTL / periodic prune (basic here; sophisticated presence P5/P8) |
| order.events emission breaks the saga tx | L×H | Emit in the SAME tx as the existing status update + outbox (atomic); it's one more outbox row, same pattern |
| WS scaling/state on multi-instance | M×M | `@socket.io/redis-adapter` pub/sub; stateless handlers; assignment in Redis not memory |

## Security considerations
- WS handshake authenticated (JWT); driver vs customer authorization; a customer can only join their OWN order's room (ownership check); rate-limit + validate location (lat∈[-90,90], lng∈[-180,180]).
- All GEO keys + rooms + queries tenant-prefixed from the verified identity — no cross-tenant driver/position/assignment leakage.
- Redis internal-network only. WS port dev-exposed; Nginx WS-upgrade + TLS = P8.

## Next steps
`order.events` now flows → P6 analytics/notification consume it. gRPC delivery server (server-to-server assign/location stream) when a caller needs it (P5 notification pushes ETA). 4c media is the last independent P4 track.
