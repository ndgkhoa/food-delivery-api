# Adversarial Review — PR #7 `feat/order-service` (Slice 2b: order microservice)

Reviewer: code-reviewer | Date: 2026-07-27 | Scope: `git diff develop...feat/order-service` (~3196 LoC)
Verdict: **1 Critical correctness defect** (idempotency key wedge + orphan stock hold). Optimistic lock, tenancy, ownership, money handling are sound.

---

## CRITICAL

### C1 — Any post-claim exception permanently wedges the idempotency key (and can orphan a stock hold)
Files: `application/order/commands/place-order.handler.ts:74-81, 96-116, 119-133`; `claim-idempotency-key.ts`; `infrastructure/persistence/transaction/typeorm-transaction.adapter.ts`

Root cause: the idempotency claim commits in **its own transaction, before** any order row is persisted, and the replay path (`loadReplayedOrder`) only ever **loads** the order — it never **re-drives** the (idempotent) saga. The order row is persisted only AFTER `reserve()` returns (as RESERVED, or as CANCELLED on `ok=false`). Therefore the window claim → reserve → persist always exists, and any thrown error inside it leaves: key claimed, no order row, retries short-circuited forever at step 1.

Sequence in `execute()`: replay-check (74) → catalog validate (84) → `claimIdempotencyKey` COMMIT (96) → `inventory.reserve` (106) → persist (116). Note catalog-before-claim correctly protects catalog failures — only inventory/persist failures wedge.

Concrete failure scenario (single client, sequential retry — NOT the documented "concurrent identical retry" item):
1. POST /orders, Idempotency-Key K. Catalog OK. `orderId=U` generated, claim(K→U) committed.
2. `inventory.reserve` exceeds `CALL_TIMEOUT_MS` (5s) → rxjs `TimeoutError` → `retryOnAborted` rethrows (not ABORTED) → `mapError` returns a generic Error → propagates → **500**. No order row written.
3. A gRPC timeout does NOT prove the call didn't execute. If reserve actually landed on inventory, stock for `U` is now **held with no order and no release path** (nothing ever calls `release(U)` — there is no order to cancel).
4. Client retries with **same K**: `findOrderId(K)→U` → `loadReplayedOrder` → `findById(U)` → `undefined` → `IdempotencyConflictError` "still being created — retry shortly" → **409, forever**. The key is dead.
5. Client cannot recover: same K → permanent 409; a **fresh** key re-reserves the same items against a new orderId → risk of **double reserve / oversell** if step-3 reserve had landed.

Same class also reachable via: `inventory.reserve` throwing `OrderConcurrencyConflictError` when ABORTED retries exhaust (`inventory-grpc.adapter.ts:90-91`); the post-reserve persist failure path (`persistReserved` compensates the release best-effort but still leaves key claimed + no order → wedge on next retry); and the un-guarded CANCELLED save on `ok=false` (line 112) if that save itself throws.

Test gap: `place-order.handler.spec.ts:175-184` proves the compensating `release` fires on persist failure, but never retries with the same key afterward — so it does not observe that the key is now permanently wedged. E2E only exercises the happy sequential replay.

Fix options (either resolves it):
- Persist a PENDING order row **in the same transaction as the claim, before reserve**; on replay where the row is PENDING, re-drive `reserve` (idempotent by orderId) → transition to RESERVED. This makes the saga crash-recoverable.
- Or: make `loadReplayedOrder` (and the claim-conflict branch) **re-drive** the saga for a claimed-but-unpersisted key instead of throwing 409, since `reserve(orderId)` is idempotent.

This is beyond documented accepted item (a) (concurrent identical retries → 409 winner-hint): this is a single caller's own retry after a transient inventory blip, and it is permanent, plus it can strand real stock.

---

## HIGH

### H1 — `qty` has no upper bound → integer overflow after claim → 500 + wedge (C1) with trivial input
Files: `interface/http/dto/place-order-item.request.ts:7-9` (`@IsInt @IsPositive`, no `@Max`); `domain/order/order-item.ts:18-22` (positive-int only); migration columns `total_cents`/`line_total_cents` are `integer`.

Any client can send `qty: 3000000000`. Domain checks pass (positive integer). `lineTotalCents = qty * unitPriceCents` (JS number, no overflow guard) exceeds Postgres `integer` max (2,147,483,647). Flow: claim committed → reserve(3e9 units) → `ok=false` → `save(CANCELLED)` inserts `total_cents ≈ 1.5e12` into an `integer` column → Postgres `22003 numeric_value_out_of_range` → raw throw (InsufficientStockError never reached) → **500**, and per C1 the key is now wedged. Trivially exploitable, no auth needed beyond a normal token.
Fix: add `@Max(...)` (a sane per-line cap) to `qty`, and/or widen columns to `bigint` with explicit domain bounds. Bounding `qty` also protects the inventory reserve from absurd quantities.

---

## MEDIUM

### M1 — No upper bound on `items` array length
File: `interface/http/dto/place-order.request.ts:7` — `@ArrayMinSize(1)` but no `@ArrayMaxSize`. A client can submit tens of thousands of line items → one large `catalog.getMenuItems` call + large multi-row insert. Add `@ArrayMaxSize(N)`.

### M2 — Compensation / failure sub-paths are non-transactional and can themselves wedge
File: `place-order.handler.ts:112` (`save(pendingOrder.cancel())` not in a try/catch or transaction) and `persistReserved` catch block. These are variants of C1: if the CANCELLED save throws, the InsufficientStockError is swallowed and the key wedges. Folds into the C1 fix (persist-before-reserve makes these paths recoverable).

---

## LOW

- **L1** `retryOnAborted` worst case = 3 × 5s timeout + backoff ≈ 15s per reserve before failing, all synchronous on the HTTP request. Consider a shorter per-attempt deadline or an overall budget. (`retry-on-aborted.ts:20`, `inventory-grpc.adapter.ts:26`)
- **L2** `catalog-grpc.adapter.ts:44-59` has no try/catch mapping; a raw gRPC error propagates. Harmless here (occurs before claim, caught by Nest default → generic 500, no internals leaked), but inconsistent with the inventory adapter's `mapError`.
- **L3** Domain error messages embed the order UUID (`errors.ts:16-21` etc.). Not PII and caller-supplied; negligible.

---

## Verified-correct (checked, no defect)

- **Optimistic lock** (`typeorm-order.repository.ts:62-86`): atomic `UPDATE ... WHERE id AND tenant_id AND version = :v`, `version + 1`, `affected === 0 → OrderConcurrencyConflictError` → 409. Concurrent cancel/confirm: first wins, second sees 0 rows → 409. No lost update. `@VersionColumn` + DEFAULT 1 + `toNewOrderOrm` leaving version unset are consistent (insert reads back 1; PENDING is never persisted so lifecycle starts at RESERVED/CANCELLED).
- **Idempotency store** (`typeorm-idempotency.repository.ts:27-32`, migration PK `(tenant_id,user_id,key)`): raw `INSERT` (not upsert) → real `23505`; `claim-idempotency-key.ts` detects it and re-reads the winner. Replay is scoped by `(tenant,user,key)` so no cross-user replay. Documented item (b) (concurrent same-key → 409 hint) is as-specified; no double-charge/double-reserve found in the concurrent path.
- **gRPC adapters**: tenant travels in metadata via `buildTenantMetadata` (never trusted from body); `firstValueFrom(...pipe(timeout(5000)))` — no hang, timeout cancels the subscription; `retryOnAborted` bounded (3) and only on ABORTED against idempotent reserve/release; error mapping ALREADY_EXISTS→conflict, ABORTED→409 is sound.
- **Money/trust**: totals computed server-side from catalog `priceCents`, integer cents throughout; client never supplies price; `qty` re-validated in domain; availability + tenant scope enforced before reserve (`buildOrderItems`).
- **Multi-tenancy + ownership**: every `findById` is `(tenantId, id)`-scoped; get/cancel/confirm call `assertOrderOwnership` (owner-or-admin); admin cannot cross tenants because the load is already tenant-scoped. `TrustedIdentityInterceptor` supplies tenant/actor from the gateway-verified identity, not raw headers.
- **State machine** (`order.ts:11-16`): explicit transition table, CONFIRMED/CANCELLED terminal, immutable transitions returning new instances.
- **Migration**: FK cascade, CHECK constraints (non-negative total, positive qty), tenant + tenant/user indexes present.
- **No N+1**: catalog validation is a single batched call over distinct ids; `findById` is 2 fixed queries.

---

## Unresolved questions
1. Is there any out-of-band reaper/reconciler (outside this diff) that would sweep claimed-but-unpersisted idempotency keys or orphaned inventory holds? If not, C1 is fully unrecovered until P3.
2. Confirm `TrustedIdentityInterceptor` (shared-tenancy, already merged) rejects requests lacking verified identity headers — the order service's entire authz model trusts it. Out of this diff's scope but load-bearing.
