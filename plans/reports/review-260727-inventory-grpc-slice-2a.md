# Adversarial Review — PR #6 `feat/inventory-service-grpc` (Slice 2a)

Scope: diff `develop...feat/inventory-service-grpc` (87 files, ~2986 LOC). Focus: distributed lock, no-oversell invariant, gRPC/proto, tenant isolation, hexagonal boundaries, UoW.

Verdict: **2 Critical, 2 High, 3 Medium, 3 Low.** The no-oversell invariant — the whole point of the slice — is NOT as safe as the code comments claim. One oversell path is deterministic (no race needed).

---

## CRITICAL

### C1. Duplicate itemId in one ReserveRequest → deterministic oversell (no race)
`apps/inventory/src/application/reservation/commands/reserve-stock.handler.ts:90-113`

`stockByItem` is built once, then the loop calls `stock.reserve(qty)` per line item. `Stock.reserve` returns a NEW instance; the map keeps the ORIGINAL. Two line items with the **same itemId** both read the original `available`, both pass the domain check, and each `save()` writes an absolute value computed from the stale read.

Scenario: `available=6`, request `items=[{item,qty:6},{item,qty:6}]`.
- iter 1: reserve → available 6-6=0, save 0.
- iter 2: `stockByItem.get(item)` is still the original (available=6) → 6-6=0, save 0.
- Result: DB available=0, **two ACTIVE reservations of qty 6 = 12 units reserved against stock of 6.** DB `CHECK(available>=0)` passes (0≥0), so it is NOT caught.

No lock expiry, no concurrency — a single malformed gRPC call oversells. The gRPC edge does not dedup/aggregate items and there is no unique constraint to catch it.

Fix: aggregate qty by itemId before processing (reject or sum duplicates), OR re-read from the map after each decrement (`stockByItem.set(item.itemId, updated)`), OR use an atomic conditional DB update.

### C2. Oversell if the Redis lock expires mid-transaction — DB CHECK is NOT a sufficient backstop
`reserve-stock.handler.ts:59-113`, `apps/inventory/src/infrastructure/persistence/repositories/typeorm-stock.repository.ts:22-33`

The Redis mutex is the ONLY real guard. When it fails to be mutually exclusive (TTL 5s expires during a slow tx / GC pause, Redis failover/split-brain, or the hold-and-wait below), two reserve txs run concurrently and lose updates:
- `findByItemIds` uses a plain `SELECT` — **no `FOR UPDATE`**, no optimistic version.
- `stock.reserve` computes `available-qty` in the domain from the value read at tx start.
- `save()` issues an absolute `UPDATE ... SET available=$computed WHERE pk` — no `WHERE available>=qty` guard.

Under Postgres default READ COMMITTED: tx B's SELECT reads the pre-decrement value while tx A is uncommitted; B's UPDATE blocks on A's row lock, then overwrites A's decrement with B's stale-based value. Both non-negative → `CHECK` passes → oversell.

The repeated comments ("the fencing token + DB re-check keep correctness even if the lock expires early", handler:31-33; "DB CHECK as a second line of defense", stock.ts:48-49) are **misleading**. The `CHECK` only catches a *single* tx computing a negative value; it does not prevent concurrent lost updates. And the fencing token (C-note below) is never enforced at the DB, so it provides zero protection against a stale holder.

Fix (any one truly closes it): pessimistic `SELECT ... FOR UPDATE` on the stock rows inside the tx; OR optimistic `@VersionColumn`; OR replace read-modify-write with atomic `UPDATE stock SET available=available-$qty WHERE tenant_id=$t AND item_id=$i AND available>=$qty` and treat 0-rows-affected as InsufficientStock. Then the DB — not Redis — becomes the real backstop and the lock is a pure performance optimization.

**Fencing note:** `RedisDistributedLock.acquire` INCRs a monotonic token, but `withLocks` never passes it to `fn`, and no DB write carries/checks it. So there is no end-to-end fencing — the token only serves compare-and-delete release safety (which works). Either wire the token into a DB fence check or stop calling it a fencing token in the comments.

---

## HIGH

### H1. Reserve idempotency is not DB-enforced
`reserve-stock.handler.ts:85-88`, migration `.../1753747200000-create-inventory-tables.ts`

Idempotency relies solely on `findActiveByOrder` read-check *inside* the Redis lock. There is no unique constraint on `reservations(tenant_id, order_id)` or `(tenant_id, order_id, item_id)`. If the lock expires/fails (see C2), two concurrent identical reserves for the same `orderId` both see zero existing active rows (each other's inserts uncommitted) → double-insert reservations + double-decrement stock. A partial unique index `(tenant_id, order_id, item_id) WHERE status='ACTIVE'` would make the DB the idempotency backstop and turn the double-reserve into a constraint violation instead of silent corruption.

### H2. `LockContentionError` under legitimate load escapes as gRPC UNKNOWN + flakes the concurrency test
`reserve-stock.handler.ts:63-77`, `libs/shared/locking/src/redis-distributed-lock.ts:52-64`

`acquireBlocking` throws `LockContentionError` once the 5s wait budget elapses. That throw happens in `withLocks` *before* `fn`, so it is OUTSIDE the handler's `try/catch` (which only maps `InsufficientStockError`/`StockNotFoundError`). Consequences:
- Under a hot item with many waiters or a slow DB (each critical section >~100ms), tail waiters exceed 5s → reserve rejects with gRPC `UNKNOWN`, not a clean `ok:false`. The order-service caller sees a hard error rather than out-of-stock.
- The load-bearing e2e (`inventory-reserve-concurrency.e2e-spec.ts:73-85`) does `Promise.all` over 50 attempts expecting 40 clean `ok:false`. On a slow CI box some attempts throw `LockContentionError` → `Promise.all` rejects → **the correctness proof is flaky**, and green CI does not actually prove no-oversell.

Fix: catch `LockContentionError` and map to a retryable gRPC status (`ABORTED`/`RESOURCE_EXHAUSTED`), or surface as `ok:false` with a distinct reason; give the wait budget headroom and add jitter.

---

## MEDIUM

### M1. No input validation at the gRPC boundary → internal errors leak
`apps/inventory/src/main.ts` (no `ValidationPipe`), `inventory.grpc.controller.ts:30-37`, `stock.ts:66-69`

Inventory is a pure microservice with no global pipe. `qty` (proto `int32`) is unvalidated: `0`, negative, or a value that fails `Number.isInteger` reaches `Stock.reserve`/`Reservation.create`, which throw a **generic `Error('Quantity must be a positive integer')`**. That is not caught by the handler → propagates as gRPC `UNKNOWN` leaking the internal message. Empty `items` returns `ok:true, reservationIds:[]` (silently a success). Validate at the edge and map to `INVALID_ARGUMENT`.

### M2. Hold-and-wait inflates lock hold time
`redis-distributed-lock.ts:77-82`

`withLocks` acquires the first key, then may block up to `waitTimeoutMs` acquiring the next while still holding the first. For multi-item carts this lengthens critical sections on already-acquired keys, raising the probability of the C2 TTL-expiry window and lowering throughput on hot items. Sorted order prevents deadlock but not this amplification. Consider try-acquire-all-or-release-and-retry, or a shorter per-key wait.

### M3. "Backoff" is a constant poll, no jitter
`redis-distributed-lock.ts:22,62` — comment says "short backoff"/"backoff" but `retryDelayMs` is a fixed 25ms with no exponential growth or jitter → thundering herd under high contention, and every poll also burns an `INCR` on the fence counter. Rename or implement real backoff+jitter.

---

## LOW

- **L1.** Fence counter keys `${key}:fence` are created by `INCR` with no TTL → persist forever (bounded by item count, but unbounded over the item catalog lifetime). `acquire` INCRs even when the subsequent `SET NX` fails, so tokens are consumed on every failed poll. Cosmetic; monotonicity still holds. `redis-distributed-lock.ts:41-43`.
- **L2.** Reserve idempotency returns existing `reservationIds` without checking the new request's items/qty match the stored ones. If an `orderId` is reused with a different cart, stale reservations are returned silently. Assumes app-level orderId uniqueness. `reserve-stock.handler.ts:85-88`.
- **L3.** `withLocks` release failures are swallowed (`.catch(() => undefined)`) with no logging — a Redis blip during release leaves the key held until TTL with zero observability. Acceptable for correctness, poor for ops. `redis-distributed-lock.ts:86-88`.

---

## Positives (verified, do not regress)

- Compare-and-delete Lua release is correct and tested holder-only (`redis-distributed-lock.spec.ts:93-104`); sorted multi-key acquire + finally-release-on-partial verified (`:108-144`).
- Tenant read from gRPC metadata, never the body; fail-closed `UNAUTHENTICATED`; catalog query is context-tenant-scoped and cross-tenant leak is explicitly tested (`catalog-get-menu-items-grpc.e2e-spec.ts:136`). Solid tenant isolation.
- Hexagonal boundaries clean: domain has no ORM/framework imports; ports/adapters + mappers; ALS UoW keeps TypeORM out of the application layer; `synchronize:false`, migrations only.
- `PROTO_LOADER_OPTIONS` (`defaults+arrays`) + `In([])` short-circuits correctly materialize empty repeated fields as `[]`.
- Multi-item atomic rollback and clean `ok:false` for business failures are correct and tested.

---

## Unresolved questions

1. Is C2's lock-expiry oversell an accepted risk for Slice 2a (documented, deferred to a DB-guard hardening ticket), or must it close before merge? The invariant is the slice's headline.
2. Expected caller (order-service) behavior on gRPC `UNKNOWN`/contention — retry or fail the order? Determines H2 severity.
3. Is `orderId` globally unique per cart (guarantees H1/L2 assumptions), or can it be reused?
