# Slice 3c — Order Saga / Outbox / Inventory+Payment consumers — Red-Team Review

Branch `feat/order-saga-events` vs `develop`. Focus: correctness in FAILURE / COMPENSATION / REDELIVERY branches (happy + concurrency already proven green). Runtime green not re-litigated.

## Verdict
No **Critical** correctness defect found. Core saga (tx atomicity, dedupe chain, state-machine guards, tenant scope, idempotent effects) is airtight end-to-end. The one meaningful risk is a **saga-strand via indiscriminate poison-skip** (no DLQ) — HIGH, and exactly what 3d must harden. Everything else is Medium/Low polish.

---

## VERIFIED CORRECT (do not re-check)

- **Tx atomicity of reply handlers (suspect #1).** Both `handle-inventory-reply.handler.ts` and `handle-payment-reply.handler.ts` wrap `IdempotentConsumer.runOnce` in `transaction.runInTransaction`. All four collaborators enlist in the SAME ALS `EntityManager`: saga repo, order repo (`typeorm-order.repository.ts:22-33`), outbox writer (`typeorm-order-outbox.adapter.ts:49-53`), processed-event store (`typeorm-processed-event.store.ts:33-35`) each fall back to `getTransactionalEntityManager()`. So dedupe row + saga transition + order status + next-command outbox row commit-or-rollback together. A crash mid-handler leaves nothing applied → clean redelivery.
- **Dedupe write-first ordering.** `IdempotentConsumer.runOnce` inserts `processed_events(eventId)` FIRST, then runs the effect, all in one tx. A throw in `apply()` rolls back the dedupe row too → retry sees a clean ledger. No "deduped-without-effect" strand from a throw. A stale no-op reply DOES commit its dedupe row (correct — that event is genuinely done).
- **State-machine guards — no illegal-transition poison (suspect #3).** Every `saga.transition(X)` call is preceded by a state guard that makes X legal per `ALLOWED_TRANSITIONS` (`order-saga.ts:15-21`): StockReserved/Failed guarded `state===STARTED`; StockReleased guarded `state===COMPENSATING`; both payment replies guarded `state===STOCK_RESERVED`. No `(state,event)` pair reaches an illegal `transition()` → `IllegalSagaTransitionError` can't fire on any live path → no throw-driven strand. Stale replies (late StockReserved after CANCEL, late PaymentSucceeded after COMPENSATING, etc.) all hit `return` no-ops. No wrong/re-transition.
- **Order aggregate transitions all legal & guarded** (`order.ts:11-16`): PENDING→RESERVED (StockReserved), PENDING→CANCELLED (StockReservationFailed), RESERVED→CONFIRMED (PaymentSucceeded), RESERVED→CANCELLED (StockReleased). Saga-STARTED ⟺ order-PENDING invariant holds because only these handlers move either.
- **Optimistic-lock vs dedupe interaction (suspect #2).** For a duplicate SAME-eventId delivery, `processed_events` PK unique-violation serializes the two txs (2nd blocks then gets `DuplicateEventError` → skip) — the saga version guard is redundant belt-and-suspenders. A `SagaConcurrencyConflictError` (if it ever fired) rolls back → retry re-loads the now-advanced saga → state guard no-ops → success. Self-healing, not a strand.
- **Exactly-once ChargePayment / single reply per command.** ChargePayment appended only inside the deduped StockReserved transition → emitted once even under StockReserved redelivery. Inventory/payment reply appended under command-eventId dedupe in the SAME tx as `markProcessed` (`inventory-command.consumer.ts:86-90`, `payment-command.consumer.ts:84-88`) → at most one reply row per command → order ever sees at most one reply eventId per leg. Dedupe key is the stable outbox row `id` (= eventId in headers), constant across relay republish. Chain is end-to-end correct.
- **Reserve/Release idempotency (suspect #4).** Reserve returns existing active reservations on replay (`reserve-stock.handler.ts:149-153`, with `assertReplayMatches`); release uses atomic ACTIVE→RELEASED `releaseIfActive` gate so double-release adds stock exactly once (`release-stock.handler.ts:64-73`). Effect running OUTSIDE the reply-dedupe tx in the inventory consumer is therefore safe.
- **Outbox at-least-once + no lost row (suspect #5).** `markPublished` runs only after `publishBatch` resolves, and guards `publishedAt IS NULL` (`typeorm-order-outbox.adapter.ts:110-118`); publish failure → `tick` backoff, rows stay unpublished. No "marked-without-publish" black hole. Crash between publish and mark → republish → consumer dedupes. FOR UPDATE SKIP LOCKED short-tx claim is correct.
- **Payment stub determinism (suspect #6).** `decideCharge` is a pure fn of `(totalCents, failAtCents)` (`charge-decision.ts`), reply deduped by command eventId. `PAYMENT_STUB_FAIL_AT_CENTS` guarded by `getOrThrow` (consumer ctor) AND has a schema default `66600` (`payment-env-schema.ts:18`) so it can't be unset.
- **PlaceOrder async rewrite (suspect #7).** Claim + PENDING order + STARTED saga + ReserveStock append are ONE tx (`place-order.handler.ts:113-129`); idempotency `save` is the FIRST write so a concurrent-key unique-violation rolls back the whole tx → no orphan order, no duplicate ReserveStock (`resolveConcurrentClaim` just returns the winner). Replay path (`loadExisting`) returns existing order WITHOUT entering the tx → no second command. Catalog validate correctly outside the tx (query).
- **Tenant scope (suspect #8).** Subscriber runs handler inside `tenantContext.run({tenantId: envelope.tenantId})` (`kafka-consumer.ts:53-56`) — never the payload. Saga lookup `findByOrderId(tenantId, orderId)` and the optimistic UPDATE both filter `tenant_id`; order `findById`/`updateStatus` filter `tenant_id`; outbox `append` reads tenant from context, not the entry. A tenant-A reply cannot mutate a tenant-B saga/order. (Belt: orderId is a UUID so cross-tenant collision is impossible anyway.)
- **Topic-ensure fix (suspect #9).** `ensureTopicsExist` (`kafka-consumer.ts:107-124`): `admin.connect()`→try `createTopics`→`finally admin.disconnect()`. No admin leak on createTopics throw; a throw propagates out of `subscribe` → `onApplicationBootstrap` fails LOUDLY (not swallowed). Idempotent, races the producer's ensure harmlessly (proven by green boot).
- **Migrations (suspect #10).** down() drops in reverse/no-FK order; identity+dedupe cols NOT NULL; partial index `idx_*_outbox_unpublished ON (created_at) WHERE published_at IS NULL` matches the relay scan; `processed_events` PK = event_id covers the dedupe insert. No plan/finding tokens in code or migration filenames; all new files <200 lines; payment is a headless `createApplicationContext` worker (no HTTP/gRPC).

---

## Findings

### HIGH

**H1 — Indiscriminate poison-skip strands the saga & leaks a stock hold (no DLQ).**
`libs/shared/messaging/src/kafka-consumer.ts:45-73` (`runHandlerWithRetry`) swallows **every** error after `maxAttempts` (default 3; delays 200+400ms ≈ ≤600ms total) then `commitPast()` advances the offset (`:183`). Because the reply handlers are fully idempotent, the failure mode this creates is asymmetric and bad:

- Scenario: PaymentFailed drives saga→COMPENSATING + ReleaseStock (order stays RESERVED, stock still held). The StockReleased reply handler hits a **transient** infra fault lasting >600ms (DB failover, lock timeout, brief pool exhaustion). 3 quick retries exhaust → error logged + **offset committed** → the StockReleased event is permanently skipped. Saga is stranded in COMPENSATING forever; order stuck RESERVED; the reserved units are **never returned to stock** (silent oversell-reduction / inventory leak). Same shape strands any leg (order stuck PENDING/RESERVED).
- Root issue: a transient/retryable error is treated identically to a genuinely poison (undecodable) message. For an idempotent consumer the safe default is the opposite — **do not advance the offset on non-decode errors**; let redelivery retry indefinitely (idempotency makes infinite redelivery safe) until infra recovers.

Fix (for 3d): classify errors — commit-past only for permanent/undecodable failures (already handled separately at `:155-171`); for handler exhaustion, either (a) stop committing the offset so the partition redelivers after recovery, or (b) route to a DLQ topic before committing. Optionally lengthen the retry budget. This is the single most important gap and precisely the FAILURE/redelivery branch 3d is meant to hammer.

### MEDIUM

**M2 — `attempts` outbox column is dead.** All three outbox tables define `attempts integer NOT NULL DEFAULT 0` but neither `OutboxRelay` nor any adapter ever increments it (grep-confirmed: no writer). So there is zero visibility into a row that repeatedly fails to publish, and no basis for a future publish-side DLQ/poison threshold. Either wire it (bump on publish failure) or drop it until 3d needs it.

**M3 — No correlation-id propagation across the saga.** Every `outbox.append` mints a fresh `randomUUID()` correlation id (`typeorm-order-outbox.adapter.ts:63`, payment adapter `:58`) instead of threading the originating request/saga correlation. Result: ReserveStock, its StockReserved reply, ChargePayment, PaymentFailed, ReleaseStock, StockReleased for one order each carry a DIFFERENT correlation id → you cannot trace one saga end-to-end in logs. Acknowledged in the comment, but it materially hurts debuggability of exactly the failure paths 3d exercises. Recommend carrying orderId-derived or start-of-saga correlation through the outbox entry.

### LOW

**L4 — `payment/main.ts` bootstrap has no `.catch`.** `bootstrap()` (`:20`) is invoked without a rejection handler; a startup failure (Kafka/DB down, createTopics throw) becomes an unhandled promise rejection rather than a clean logged non-zero exit. Add `.catch(err => { Logger.error(...); process.exit(1); })`.

**L5 — `idx_order_saga_tenant_id` is unused.** `findByOrderId` filters by PK `order_id` (+ tenant), so the standalone tenant index serves no current query (no list-by-tenant exists). Harmless, minor write cost. Drop or defer.

**L6 — "Phase 1/Phase 2" comments in test support.** `apps/order-e2e/src/support/boot-order-stack.ts:88,114` use "Phase 1/2" for boot sequencing. Not plan-artifact refs, but brushes the no-"phase"-token convention; prefer "Step 1/2" for zero ambiguity. Nit.

---

## Notes / non-issues confirmed
- `reason` strings in replies ("insufficient stock", "payment declined for amount N") carry no PII/secret and the order handlers ignore them — no data leak.
- Cross-consumer (inventory-reply vs payment-reply) races on one order are causally impossible (payment reply cannot precede its ChargePayment which cannot precede StockReserved commit); optimistic lock covers the theoretical duplicate-delivery case.
- Single shared `processed_events` ledger per service is safe: event ids are globally-unique UUIDs (row ids from distinct outbox tables).
- No `order`→`inventory`/`payment` source import (they communicate only via Kafka event types); consistent with dependency-cruiser pass.

## Unresolved questions
1. **Retry budget policy for 3d:** confirm the intended semantics on handler exhaustion for idempotent consumers — block-and-redeliver (offset not advanced) vs DLQ-then-skip? H1's fix depends on this decision.
2. **Does the confluent `createTopics` truly no-op (not throw) on an existing topic in your broker version?** Proven green today, but if a future vendor bump throws `TOPIC_ALREADY_EXISTS`, every post-first boot would fail loudly at `ensureTopicsExist`. Worth a defensive swallow of already-exists.
3. Is a saga expected to ever be reaped/timed-out if a reply is lost (pre-DLQ)? Today a lost reply = permanent strand with held stock; confirm 3d adds a sweeper or DLQ.

**Status:** DONE_WITH_CONCERNS
Core saga logic is correct and the dedupe/tx/state-machine chain is genuinely airtight — no data-corruption or oversell/double-charge defect. Single most important finding: **H1 — indiscriminate poison-skip in `runHandlerWithRetry` commits the offset on transient infra faults, permanently stranding the saga and leaking the reserved stock hold; idempotent reply handlers should NOT advance the offset on non-decode errors (or need a DLQ) — the top item for slice 3d.**
