# Slice 4b — Delivery Realtime Red-Team Review

Branch `feat/delivery-realtime-tracking` — `git diff develop...HEAD` (1 commit). Runtime already GREEN; this hunts correctness/security bugs the happy-path e2e does not exercise. Focus: WS auth, tenant isolation, concurrency.

## Verdict
WS handshake auth and tenant-key isolation are **solid and correctly implemented**. One **real concurrency invariant violation** (one-order-per-driver) and one **live operational correctness gap** (stale/offline drivers stay assignable) are the load-bearing findings. Everything else is Medium/Low or acknowledged scope.

---

## Critical

### C1 — `one-order-per-driver` is a check-then-set race → driver double-booked under concurrency
`apps/delivery/src/application/assign-driver.handler.ts:32-58` + `apps/delivery/src/infrastructure/redis/redis-assignment.store.ts:36-48`

`HSETNX` guards only the **order → driver** field (per orderId). It does NOT guard the driver's busy status. Sequence for two DIFFERENT orders confirmed concurrently:

1. `order.events` is keyed by orderId → orders A and B land on different partitions → processed **concurrently** (KafkaJS processes partitions in parallel; also true across multiple delivery instances).
2. Handler A: `busyDriverIds()` = {} → `selectNearestAvailableDriver` picks D1 (all distances 0, first free in list).
3. Handler B (before A's `sadd busy`): `busyDriverIds()` = {} → also picks **D1**.
4. A: `HSETNX assign:{t} A D1` → created=1 → `sadd busy D1`, `sadd assign:{t}:driver:D1 A`.
5. B: `HSETNX assign:{t} B D1` → **different field → created=1** → `sadd busy D1`, `sadd assign:{t}:driver:D1 B`.

Outcome: D1 assigned to **both** A and B. `ordersForDriver(D1)` = {A,B}, so D1's location fans out to **both** rooms — customer B watches a courier actually serving A. This violates the invariant the code comments explicitly claim ("two concurrent deliveries can never double-assign", "one-driver-per-order" busy roster). The e2e only exercises single-order and same-order redelivery (both protected by the per-field HSETNX), so it never catches this.

**Fix:** make claim-a-free-driver atomic. Options: (a) a Lua script that, in one round-trip, checks `SISMEMBER busy driverId`, and only if absent does `HSETNX order` + `SADD busy` + `SADD driverOrders`; or (b) `SADD busy driverId` as the *first* claim and treat `added==0` as "someone took this driver, re-pick next candidate" loop. Reserve the driver, then bind the order.

---

## High

### H1 — Stale/offline drivers stay assignable; busy drivers never freed
`redis-driver-location.store.ts:49-52` (`onlineDriverIds` = `ZRANGE` all members), `assign-driver.handler.ts:38-41`. No `OnGatewayDisconnect`, no GEO member TTL/heartbeat, no `ZREM`/`SREM`/unassign anywhere (grep confirmed).

- `onlineDriverIds` returns **every driver that ever pushed a position**, not currently-connected ones. A driver who crashed/disconnected an hour ago is still selected and assigned an order they will never fulfil (and still surfaces in `nearby`).
- `busy` set is never cleared (comment acknowledges unassign is future work). Over the service lifetime the free pool monotonically shrinks; once every driver is "busy", **all** new orders log "no available driver" and go unassigned.

Combined effect: assignment quality degrades to zero over uptime. The "no driver → clean no-op" e2e passes because that test starts with an empty pool. **Fix:** expire GEO members on a heartbeat (periodic re-GEOADD + `ZREMRANGEBYSCORE`/per-member TTL via a companion sorted-set of last-seen ms), remove driver on disconnect, and free `busy` on order completion.

---

## Medium

### M1 — Intra-tenant join-order authz gap: any tenant user can watch any courier's live location
`delivery.gateway.ts:125-146`. `join-order` only checks that an assignment **exists** in the caller's tenant — not that the caller owns the order. Any authenticated user in tenant T can `join-order {someOtherCustomersOrderId}` and receive that order's live driver-location stream. This is live location/PII exposure across customers within a tenant. Comment acknowledges "full owner-of-order check is a later refinement," but flag it: at minimum bind room membership to the order's `userId` (customer) or `driverId` (assigned driver) from the verified identity.

### M2 — Redelivered `OrderConfirmed` re-broadcasts `assigned` spuriously
`order-events.consumer.ts:64-77`. No event-id dedupe (relies solely on assignment idempotency). On every redelivery, `assignDriver.execute` returns the existing assignment (truthy) → `broadcastAssignment` fires again → duplicate `assigned` event to the room. Harmless to state, noisy to clients and re-emits on each redelivery. **Fix:** only broadcast when the assignment was newly created (return a `created` flag from `assign`), or dedupe by `envelope.eventId`.

## Low

### L1 — `nearby-drivers` ignores the path `orderId` and has no role check
`delivery.controller.ts:31-42`. The `:orderId` is UUID-validated then discarded (`_orderId`); the query uses arbitrary client-supplied `lat/lng`. Any tenant user (incl. a customer) can enumerate the tenant's driver positions by scanning coordinates. Tenant-scoped so no cross-tenant leak; intra-tenant position enumeration only. Consider scoping to the order's pickup point / restricting to staff roles.

### L2 — Rate limit resettable via reconnect; `join-order` unbounded
`location-rate-limiter.ts` + `delivery.gateway.ts:125`. Per-socket window resets on reconnect (bounded by handshake+JWKS cost, so minor). `join-order` is not rate-limited — each attempt is a Redis `HGET`; a flood is a cheap amplification. Bogus orderId is cleanly rejected (no room created — verified).

### L3 — Token via query param + `cors.origin:'*'`
`handshake-token.ts:16-19`, `delivery.gateway.ts:48`. Accepting `?token=` risks the JWT landing in proxy/access logs. Auth is bearer-token (not cookie) so `origin:'*'` is acceptable for WS, but prefer `auth.token`/`Authorization` only, or document the query-param path as e2e-only.

---

## Verified correct (no action)

- **WS handshake auth is airtight.** `afterInit` uses `server.use` middleware; verify completes before `connect`, so handlers always see a populated `identity` (gateway.ts:70-87). Missing/bad/expired token → `verify` throws → caught → `next(new Error('unauthenticated'))` → socket rejected, never half-open. No token → explicit reject.
- **Identity is never client-controlled.** `identity` comes only from `verifier.verify(token)`; `extractIdentity` pulls tenant/sub/roles from **verified** claims (identity.ts:35-45). Verifier pins `RS256`, checks issuer/audience/expiry via jose `jwtVerify` (access-token-verifier.ts:24-31) — no `alg:none`/HS-RS confusion, no query/header identity smuggling.
- **`location` enforces `driver` role** (gateway.ts:96-99); a customer cannot push location.
- **All Redis keys + rooms are tenant-prefixed from the verified identity** — `geo:{t}:drivers`, `assign:{t}`, `assign:{t}:busy`, `assign:{t}:driver:{id}`, room `t:{t}:order:{id}` (redis-*.store.ts, realtime-channels.ts). Every port call receives `tenantId` from `identity.tenantId` (WS) or `TenantContextPort` (HTTP). No path uses orderId/driverId without the tenant prefix. Tenant-isolation e2e confirms A's driver invisible/unassignable in B.
- **HTTP tenant from trusted identity**, not client header — `TrustedIdentityInterceptor` global (app.module.ts:90), `tenantContext.getTenantIdOrThrow()` (controller.ts:36,46).
- **Per-order idempotency** holds: same-order redelivery → `HSETNX` no-op returns the incumbent driver (assignment.store.ts:45-47).
- **order.events emission is atomic + exactly-once per finalize.** `orderConfirmedEvent`/`orderCancelledEvent` appended to the outbox inside the same `runInTransaction` + `IdempotentConsumer.runOnce` as the status/saga transition (handle-payment-reply.handler.ts:48-78, handle-inventory-reply.handler.ts:50-124). State guards (`saga.state !== 'STOCK_RESERVED'` / `!== 'COMPENSATING'` / `!== 'STARTED'`) make a redelivered terminal reply a no-op *before* emit → no second OrderConfirmed. Payload (orderId/userId/status/totalCents) from the aggregate; correlationId threaded. No partial emit on rollback.
- **No-driver-available** → clean logged no-op, returns undefined, no crash/poison (assign-driver.handler.ts:48-53).
- **Location validation** rejects non-number/NaN/Infinity + out-of-range (location.ts:26-33); HTTP DTO mirrors bounds with class-validator.
- **`createTestKeySet` change is backward-compatible** (optional `keyPair`), fixed PEM lives only under `apps/delivery-e2e/src/support/fixed-signing-keys.ts` (test fixture, not a real credential), doesn't weaken existing shared-jwt tests.
- **Hexagonal boundaries respected** — domain imports no ioredis/socket.io/Kafka; only app.module crosses layers; order does not import delivery; `@delivery/*` alias used throughout; env schema fail-closed (`getOrThrow`, zod defaults). Redis client `quit()` on shutdown; WS adapter uses dedicated pub/sub connections closed on `close()`. No "phase"/finding tokens in code. Files <200 lines.

---

## Unresolved questions

1. Is concurrent processing of two `OrderConfirmed` (distinct orders) actually reachable in the deployed topology — how many `order.events` partitions and how many delivery consumer instances? If 1 partition + 1 instance, C1 degrades to "only across a rebalance/redeploy overlap" (still real, lower frequency). Confirm partition count.
2. Is H1's assign-to-offline-driver acceptable for this slice, or must a heartbeat-expiry land before this ships? The comments acknowledge *unassign* as future work but not *assign-to-stale*.
3. M1: is intra-tenant courier-location visibility an accepted product decision for 4b, or a gap to close before enabling `join-order` in prod?

**Status:** DONE_WITH_CONCERNS
Summary: WS auth + tenant isolation verified airtight and order.events emission is atomically exactly-once; two real correctness gaps remain. Most important: **C1 — `HSETNX` guards one-driver-per-order but not one-order-per-driver, so two concurrently-confirmed orders can both grab the same nearest driver (double-booking) — needs an atomic driver-claim (Lua/SADD-first).**
