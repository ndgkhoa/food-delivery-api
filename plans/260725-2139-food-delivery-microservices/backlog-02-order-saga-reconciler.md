# Backlog 02 — Order saga reconciler (recover stranded sagas)

Context: [plan.md](./plan.md) (Deferred backlog) · [phase-03c-order-saga-events.md](./phase-03c-order-saga-events.md) · [phase-02-order-core-inventory.md](./phase-02-order-core-inventory.md)

## Overview
- **Priority**: correctness — second backlog slice.
- **Status**: ✅ Verified live (reconcile mechanics) + adversarially reviewed (1 Critical + 1 High fixed) — branch `feat/order-saga-reconciler`. Single PR.
  - **Live evidence (real Postgres + Kafka)**: the `attempts` migration applied cleanly (column backfilled on the existing `order_saga`); a saga forced to a backdated `STARTED` was **re-driven** (re-emitted `ReserveStock` to the outbox, published to Kafka), its **`attempts` incremented 0→10**, then **escalated** at `MAX_ATTEMPTS` (`ERROR ... escalated after 10 reconcile attempts ... left for manual/DLQ-replay`) and stopped; orphaned sagas (no order row) were logged + skipped (per-saga try/catch, sweep never crashed). Offline: payment **41** + order **106** + shared-observability **33** + shared-persistence tests green; tsc/biome/dependency-cruiser (912 modules, 0 violations)/knip clean.
- **Adversarial review + fixes applied** (report `reports/code-reviewer-260802-2229-slice-order-saga-reconciler-red-team-review-report.md`; verified clean: no double-reserve [inventory idempotent by orderId], no double-charge [`REJECT_DUPLICATE` untouched], advisory lock non-blocking + distinct key 5001, tenant scope safe, migration metadata-only+reversible):
  - **C1 (Critical)** — the plan's premise that re-driving `ChargePayment` re-emits the payment reply was FALSE: `startCharge` hits `WorkflowExecutionAlreadyStartedError` and returns (no new run under `REJECT_DUPLICATE`; the reply only ever comes from the one-shot `emitReply` activity). So a saga stranded in `STOCK_RESERVED` by a LOST payment reply could never recover — it burned 10 no-op attempts and escalated with stock held. Inventory stages recover fine (their consumer re-emits on a fresh-event-id command); payment is architecturally asymmetric. **Fixed (chosen: full payment reply-replay)**: `startCharge`'s duplicate-start catch now `describe()`s the workflow; if **COMPLETED**, it `handle.result()`s the `ProviderResult` and **re-appends the reply to the payment outbox with a fresh event id** (no `IdempotentConsumer` guard) so the order reply-consumer reprocesses it → saga → COMPLETED. `REJECT_DUPLICATE` still guarantees no second charge (only the reply is replayed); a still-RUNNING workflow / a `describe()` error is a safe no-op. Injected outbox/transaction/tenant-context into the adapter.
  - **H1 (High)** — the reconciler read the saga OUTSIDE the write tx and `recordReconcileAttempt` updated `WHERE order_id` only (no state guard), so a concurrent real reply moving the saga to terminal between read and update let the reconciler re-drive an already-cancelled order → a permanent stock hold. **Fixed**: `recordReconcileAttempt(orderId, expectedState)` guards `WHERE order_id = $1 AND state = $2`; 0 rows affected → throws `SagaStateChangedError` → the tx (which also holds the outbox append) ROLLS BACK, no command emitted; `recoverOne` treats the sentinel as "saga progressed — skip" (not an error/escalation).
  - **Product decisions (user-confirmed)**: STOCK_RESERVED recovery = full payment reply-replay (C1 fix); escalation stays MANUAL (log+metric, stock left held — a charged order must not be auto-cancelled). Documented follow-ups: a DLQ-replay tool for escalated sagas; retention-expiry note on that tool (a manual replay after Temporal retention expires is the only path to a theoretical double-charge).
- **Brief**: The `SagaReaperProvider` today only DISCOVERS stranded sagas (non-terminal past a timeout — a lost/dead-lettered reply leaves an order stuck with a stock hold) and logs a worklist; it does NOT recover them. Upgrade it from discovery → **recovery**: for each stranded saga, RE-DRIVE it to a terminal state by re-emitting the command its current state is waiting on (idempotent downstream), bounded by an attempts cap that escalates instead of looping. Multi-replica-safe (advisory lock) so the prod HPA `minReplicas:2` doesn't double-run it.

## Key decisions
- **Re-drive by re-emitting the state's pending command** (idempotent downstream — verified): a stranded saga is waiting on a reply that was lost; re-issuing the command that produces that reply re-drives it. Per state (`order-saga.ts` transitions):
  - `STARTED` (awaiting StockReserved/Failed) → re-emit `reserveStockCommand(orderId, items, correlationId)`. Inventory reserves idempotently by `orderId` (`findActiveByOrder` — no double-hold).
  - `STOCK_RESERVED` (awaiting PaymentSucceeded/Failed) → re-emit `chargePaymentCommand(orderId, totalCents, correlationId)`. Payment's Temporal workflow is `REJECT_DUPLICATE` by `charge-{orderId}`, so the redelivered command never re-runs the charge — `startCharge` hits the duplicate-start error, and the gateway adapter recovers by re-appending the already-completed run's decided reply to the payment outbox under a FRESH event id (the order side's dedupe-by-event-id reply consumer then reprocesses it). A still-RUNNING run is left alone; it emits its own reply when it finishes.
  - `COMPENSATING` (awaiting StockReleased) → re-emit `releaseStockCommand(orderId, correlationId)`. Inventory release is idempotent by `orderId`.
  - Terminal (`COMPLETED`/`CANCELLED`) → never swept.
- **Bounded, escalate not loop**: add an `attempts` integer column to `order_saga` (migration, default 0). Each reconcile re-drive increments it + touches `updated_at` (so the saga isn't re-swept until the next timeout — the re-emitted command gets a full window to reply). At `attempts >= SAGA_RECONCILER_MAX_ATTEMPTS` (env, default 10) the saga is ESCALATED: logged at ERROR + a `saga_reconcile_escalated_total` metric, and NOT re-driven again (left for a human / a future DLQ-replay tool). A real reply that advances the saga is the healthy exit (attempts stays — a per-saga lifetime budget; not reset per stage — KISS, documented).
- **Atomic + idempotent write**: the re-drive command is appended to the `order_outbox` and the `attempts`/`updated_at` bump committed in ONE transaction (the outbox relay then publishes it at-least-once; downstream dedupe/idempotency handles the rest). The re-drive needs the order's `items`/`totalCents` → load the order (read) inside the reconcile.
- **Multi-replica-safe**: wrap the whole reconcile sweep in `withAdvisoryLock` (from `libs/shared/persistence`, the backlog-8c-B helper) with an order-reconciler lock key, so only one replica reconciles per tick even under HPA. (Re-drives are idempotent anyway, but this avoids duplicate Kafka traffic + keeps the attempts counter clean.)
- **Pure decision function**: a `decideReconcileAction(saga, order, maxAttempts) → { kind: 'redrive', command } | { kind: 'escalate' }` (unit-testable, the single source of truth for the per-state re-drive), mirroring how `selectStrandedSagas` is the pure selection rule.
- **Observability**: `saga_reconcile_redriven_total{state}` + `saga_reconcile_escalated_total` (shared-observability meter). The existing stranded worklist log stays.
- **Guard rails**: never re-drive a terminal saga; never charge/reserve twice — `REJECT_DUPLICATE` means only the payment REPLY is ever re-emitted, the charge activity itself never runs a second time; inventory reserve/release is idempotent by orderId; the sweep is best-effort + never throws out of the timer (existing pattern).
- **Race-safe re-drive**: the attempts-increment is a conditional `UPDATE ... WHERE order_id = :id AND state = :expectedState` (`expectedState` = the state the re-drive decision was made for), run BEFORE the re-drive command's outbox append in the same transaction. Zero affected rows (a concurrent real reply already advanced/terminated the saga) throws a sentinel that rolls the transaction back — the re-drive command is never appended for a saga that already moved on its own. The reconciler treats that as a healthy skip, not a failure.

## Related code files
- `apps/order/src/infrastructure/persistence/migrations/<ts>-add-attempts-to-order-saga.ts` — `ALTER TABLE order_saga ADD COLUMN attempts integer NOT NULL DEFAULT 0`; reversible down; register in `order-test-database.ts`.
- `apps/order/src/infrastructure/persistence/entities/order-saga.orm-entity.ts` — add `attempts` column.
- `apps/order/src/domain/saga/order-saga.ts` (+ repository) — expose `attempts`; a repository method to atomically append the re-drive command + bump attempts/updated_at (or reuse the outbox writer + a saga `incrementAttempts`/`touch`).
- `apps/order/src/domain/saga/saga-reconciler.ts` (new) — `decideReconcileAction(...)` pure fn + `NON_TERMINAL_SAGA_STATES` reuse.
- `apps/order/src/interface/messaging/saga-reaper.provider.ts` — upgrade `sweep()`: under `withAdvisoryLock`, for each stranded saga decide→(re-drive via outbox+tx, increment attempts | escalate). Inject the order read repo + outbox writer + transaction + datasource (for the lock) + the metrics helpers. Keep the never-throw timer + NODE_ENV=test guard.
- `apps/order/src/config/order-env-schema.ts` — `SAGA_RECONCILER_MAX_ATTEMPTS` (default 10). `libs/shared/observability` — add `recordSagaReconcile('redriven', state)` / `recordSagaReconcile('escalated')` (or two helpers) if not folding into existing.
- Tests: `saga-reconciler.spec.ts` (each state → correct command; attempts≥max → escalate; terminal → nothing), reaper provider test (re-drive appends the right command + increments attempts; escalation path; advisory-lock skip; never-throws), migration registered in the in-process e2e.

## Todo
- [x] `attempts` column on `order_saga` (migration reversible + registered in test DB) + entity + repo access
- [x] `saga-reconciler.ts` pure `decideReconcileAction` (per-state re-drive command / escalate at max attempts) + unit tests
- [x] upgrade `SagaReaperProvider.sweep()` → recover: advisory-locked; per stranded saga append re-drive command + bump attempts/updated_at in ONE tx, or escalate; inject order-read/outbox/transaction/datasource; never-throw
- [x] `SAGA_RECONCILER_MAX_ATTEMPTS` env + `saga_reconcile_redriven_total{state}`/`saga_reconcile_escalated_total` metrics
- [x] tests: decision fn + provider (re-drive/escalate/lock-skip/never-throw); order unit green (in-process/testcontainers e2e over the new column left for the orchestrator's live run)
- [x] biome/cruiser/knip/tsc; plan updated before push

Note: `decideReconcileAction` lives in `apps/order/src/application/saga/saga-reconciler.ts` (application layer), not `domain/saga/` as originally sketched — it composes `saga-commands.ts`, which already lives in `application/saga/`, and `domain-stays-pure` (`.dependency-cruiser.js`) forbids domain importing application. Verified via `pnpm run cruiser` (0 violations).

## Success criteria
- A saga stranded in `STARTED`/`STOCK_RESERVED`/`COMPENSATING` past the timeout is automatically re-driven (the correct idempotent command re-emitted) and reaches a terminal state once the reply returns — no order left PENDING with a dangling hold.
- Re-driving never double-reserves or double-charges (idempotency verified: inventory by orderId, payment REJECT_DUPLICATE).
- After `MAX_ATTEMPTS` with no progress the saga is escalated (ERROR log + metric), not looped forever.
- Runs safely under ≥2 replicas (advisory lock) and never throws out of the timer.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Re-drive double-reserves/double-charges | L×H | Inventory idempotent by orderId; payment Temporal REJECT_DUPLICATE; both verified — re-emit is a no-op if already applied |
| Infinite re-drive loop | M×M | `attempts` cap → escalate (ERROR+metric), stop re-driving |
| 2 replicas re-drive same saga | M×L | `withAdvisoryLock` sweep (+ idempotent even if it slipped); attempts counter stays clean |
| Bump updated_at hides a genuinely-progressing saga | L×M | Only stranded (idle past timeout) sagas are touched; a real reply advances state + is the healthy exit |
| Re-drive needs order items/total not on the saga | L×L | Load the order (read) inside the reconcile; it always exists (saga created with the order) |
| Concurrent real reply advances/terminates the saga between the reconciler's read and its write | L×H | `recordReconcileAttempt` guards its `UPDATE` on `state = :expectedState`; zero-affected-rows rolls the transaction back before the re-drive command is ever appended |
| A `ChargePayment` redelivered after the workflow completed had no reply-recovery path (payment reply lost = permanently stuck saga) | was M×H | Gateway adapter re-appends the completed run's decided reply under a fresh outbox event id on `WorkflowExecutionAlreadyStartedError` |

## Security considerations
- No new external surface; the reconciler is an internal timer. Tenant scope preserved (the saga carries tenantId; the re-drive command + order load are tenant-scoped). No PII in metrics (only state label + counts).

## Next steps
Backlog 03 — Optimistic locking (version column on updates) in order/catalog. Then security hardening (internal identity HMAC + prod Keycloak realm), then D-items (Argo, cosign, k6, BullMQ propagation).
