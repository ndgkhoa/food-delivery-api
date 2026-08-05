# Red-Team Review — Order Saga Reconciler slice (`feat/order-saga-reconciler`)

Reviewer: code-reviewer (staff-eng red-team pass) · 2026-08-02
Scope: uncommitted diff on `feat/order-saga-reconciler`. Focus = correctness of saga RECOVERY.
Verdict: **1 Critical, 1 High, findings below.** The recovery mechanism is correct for the inventory stages but **does NOT recover the payment stage's lost-reply case** — the single most important scenario the reconciler exists for.

Files reviewed: `saga-reaper.provider.ts`, `application/saga/saga-reconciler.ts`, `typeorm-order-saga.repository.ts`, `order-saga.orm-entity.ts`, `order-saga.ts`, migration, `metrics.ts`, plus downstream idempotency: `temporal-workflow-gateway.adapter.ts`, `charge-workflow.ts`, `inventory-command.consumer.ts`, `reserve-stock.handler.ts`, `advisory-lock.ts`, `handle-inventory-reply.handler.ts`.

---

## CRITICAL — C1: `chargePayment` re-drive is a permanent no-op for a completed charge workflow → STOCK_RESERVED strands caused by a lost payment reply are never recovered

This is the #1 hunt, and the answer overturns the plan's core premise.

**Plan claim (`backlog-02` line 13):** "Payment's Temporal workflow is `REJECT_DUPLICATE` by `charge-{orderId}` — a redelivered command is a no-op, **and the reply is re-emitted from the (idempotent) `emitReply` activity**."

**Reality — the reply is NOT re-emitted.** Trace:

1. Reconciler re-drives `chargePaymentCommand` → new outbox row, new eventId (`order-outbox.orm-entity.ts:14` `@PrimaryGeneratedColumn('uuid')`).
2. `PaymentCommandConsumer.handleCommand` (`payment-command.consumer.ts:75`) → `workflowGateway.startCharge(...)`. The consumer has **no reply-emit step of its own** — the reply is produced ONLY inside the workflow's `emitReply` activity (`charge-workflow.ts:60`), which runs exactly once per workflow execution.
3. `TemporalWorkflowGatewayAdapter.startCharge` (`temporal-workflow-gateway.adapter.ts:61-67`): a second start of `charge-{orderId}` throws `WorkflowExecutionAlreadyStartedError`, which is **caught and swallowed** (`return;`). No new run, no `emitReply`, **no reply.**

So when a saga strands in `STOCK_RESERVED` because the `PaymentSucceeded`/`Failed` reply was lost AFTER the charge workflow completed (dead-lettered downstream, or the order-side reply consumer dropped it) — re-driving `chargePayment` produces **nothing**. The saga does not advance. It re-drives every `SAGA_REAPER_TIMEOUT_MS` for 10 attempts (each counted as a successful redrive, see M1) then escalates. Auto-recovery for the payment stage is impossible in this case.

Why this matters: the reaper's own docstring (`saga-reaper.provider.ts:39-41`) states its purpose is a saga stranded because "a reply is lost (now dead-lettered, or genuinely never produced)." For `STOCK_RESERVED` that lost reply is the payment reply — precisely the case the re-drive **cannot** fix. Success-criterion "reaches a terminal state once the reply returns — no order left PENDING with a dangling hold" is not met for this path.

**Contrast — inventory re-drive DOES recover** (verified, so the asymmetry is real, not a blanket bug): `InventoryCommandConsumer.handleCommand` (`inventory-command.consumer.ts:83-91`) always runs the (idempotent) effect AND appends a fresh reply, deduped by the **command's** eventId. A re-driven `ReserveStock`/`ReleaseStock` carries a NEW eventId → dedupe misses → the `StockReserved`/`StockReleased` reply **is re-emitted**, while `findActiveByOrder` (`reserve-stock.handler.ts:149`) returns the existing hold with no second decrement. So `STARTED`/`COMPENSATING` strands recover; only `STOCK_RESERVED` does not.

**Repro:**
1. Place order; inventory reserves; saga → `STOCK_RESERVED`. Charge workflow `charge-{orderId}` runs, succeeds, `emitReply` writes `PaymentSucceeded` to payment outbox.
2. Drop/DLQ that reply before the order reply-consumer applies it (kill the consumer, or route to `.dlq`).
3. Saga sits `STOCK_RESERVED` past the timeout → reconciler re-drives `chargePayment`.
4. Observe payment log: "Charge workflow already running for order … — no-op". No new `PaymentSucceeded` reply is emitted. Saga stays `STOCK_RESERVED`; `saga_reconcile_redriven_total{state="STOCK_RESERVED"}` keeps climbing; after 10 ticks → escalated. Order stays PENDING with stock held.

**Fix options (pick one):**
- **(preferred) Give payment a reply-replay path symmetric to inventory.** On `WorkflowExecutionAlreadyStartedError`, look up the closed workflow's result and re-append the reply (or add a dedicated "re-emit reply for `charge-{orderId}`" gateway call the consumer invokes when the start is a duplicate). Then re-driving the command re-emits the reply like inventory does.
- **Or** re-scope the reconciler: for `STOCK_RESERVED`, recovery is a **reply replay** problem, not a command re-drive. Drive it from a DLQ-replay of the payment reply rather than re-issuing the command, and stop advertising command re-drive as the `STOCK_RESERVED` recovery.
- **At minimum**, correct the plan + the reaper docstring + `decideReconcileAction`'s comment: command re-drive recovers a **lost command / never-started workflow**, NOT a lost reply from a completed charge. Don't count a duplicate-rejected start as a `redriven` metric (see M1).

Note the flip side is also latent: this same swallow is what PREVENTS a double-charge while the workflow is still within Temporal retention (correct). The bug is specifically that it also prevents the reply replay. Any fix must preserve "no second charge."

---

## HIGH — H1: guard-less `recordReconcileAttempt` + read-before-transaction races a concurrent real reply → can leak a stock hold onto a CANCELLED order

The reconciler loads the saga OUTSIDE the write transaction and re-drives based on that stale read, with no state/version guard on the write.

- Load happens at `saga-reaper.provider.ts:153` (`findByOrderId`), decision at `:164`, but the outbox append + attempt bump only open their transaction at `:178-185`.
- `recordReconcileAttempt` (`typeorm-order-saga.repository.ts:102-109`) is `UPDATE order_saga SET attempts = attempts+1, updated_at = now() WHERE order_id = :orderId` — **no `state` guard, no `version` guard**, and the caller never checks `affected`. The advisory lock (5001) serializes reconciler-vs-reconciler only; the reply handlers do NOT take it (they use the saga `version` optimistic lock, `typeorm-order-saga.repository.ts:63-82`), so reconciler and reply-handler run concurrently.

**Worst case (stock leak):** saga is `STARTED` and idle past the timeout (its `StockReservationFailed` reply was lost; no hold exists). Reconciler loads `STARTED`, decides `reserveStock`. Concurrently the real (or a redelivered) `StockReservationFailed` reply lands → handler transitions `STARTED → CANCELLED` (`handle-inventory-reply.handler.ts:90-95`) and commits. Reconciler's tx then appends `reserveStock` unconditionally and bumps attempts. Inventory processes it: `findActiveByOrder` finds nothing → attempts a fresh reserve → **if stock is now available it succeeds, creating a hold**, and emits `StockReserved`. Order handler sees `saga.state !== 'STARTED'` (it's `CANCELLED`) → `return undefined` (`handle-inventory-reply.handler.ts:78-80`) → the hold is **never released**. Permanent stock leak on a cancelled order.

Also applies more benignly to the other states: `STOCK_RESERVED → COMPLETED` race re-emits `chargePayment` (REJECT_DUPLICATE → safe); `COMPENSATING → CANCELLED` race re-emits `releaseStock` (idempotent → safe). Only the `STARTED → CANCELLED` + reserve-succeeds-on-retry path leaks. Low probability (needs the tx-window race AND stock replenished), real and permanent impact.

Secondary: bumping `attempts`/`updated_at` on a just-terminated saga is cosmetic (terminal sagas are filtered out of `findNonTerminal`), so no resurrect — the only real damage is the emitted command.

**Fix:** make the re-drive conditional on the saga still being in the decided non-terminal state, inside the transaction, and abort (don't emit) if it moved. Either:
- add a guard to `recordReconcileAttempt(orderId, expectedState /* or expectedVersion */)` → `... WHERE order_id = :orderId AND state = :expectedState`, check `affected === 0` and throw to roll back the tx (skip the redrive) if the saga moved; or
- re-load the saga inside the transaction and re-run `decideReconcileAction` / bail if now terminal.
This closes the window and keeps the `attempts` counter honest.

---

## MEDIUM — M1: `saga_reconcile_redriven_total{state="STOCK_RESERVED"}` counts guaranteed no-op re-drives as successful redrives

Because of C1, every payment-stage re-drive against a completed workflow increments `saga_reconcile_redriven_total{state="STOCK_RESERVED"}` (`saga-reaper.provider.ts:186`) even though nothing was re-driven. An operator watching the metric sees "recovery is working" while orders silently rot until escalation. Once C1 is addressed (real reply replay), the metric becomes truthful; until then it actively misleads. Consider only recording `redriven` when a reply-producing effect actually occurred, or split a `saga_reconcile_noop_total`.

## LOW — L1: escalate-and-hold strands stock indefinitely (documented decision — flagged for confirmation)

After `MAX_ATTEMPTS` the escalate path (`saga-reaper.provider.ts:165-172`) only logs + increments a counter; the saga stays non-terminal with its hold. For `STOCK_RESERVED` this is defensible (payment may have actually succeeded — auto-cancelling without a refund would be wrong), so "leave for a human" is the safe call. But combined with C1, a `STOCK_RESERVED` strand is GUARANTEED to reach escalation and hold stock forever. Recommend: pair escalation with an alert/runbook, and confirm the product intent that inventory stays reserved for an escalated order rather than auto-releasing. Not a code defect.

## LOW — L2: retention-expiry double-charge on manual replay (out of scope, note for the follow-up tool)

`REJECT_DUPLICATE` only protects "within retention" (`temporal-workflow-gateway.adapter.ts:26-29`). The reconciler's bounded 10 × `SAGA_REAPER_TIMEOUT_MS` (≈10 min default) window is far inside Temporal retention, so the reconciler itself can't trigger a re-charge. But an escalated saga (L1) that a human/DLQ-replay tool re-drives after retention expires WOULD start a fresh `charge-{orderId}` run and charge again. Document this constraint on the future manual-replay tool referenced in the escalation log.

## LOW — L3: `attempts` is a lifetime budget, not per-stage

Documented KISS decision (`saga-reconciler.ts:24-28`, `order-saga.ts:32-38`). A saga that legitimately needed a few re-drives at `STARTED` enters `STOCK_RESERVED` with a reduced budget. With a 10-attempt default and per-attempt timeout windows this is unlikely to escalate a healthy saga prematurely. Acceptable; no change needed. (If C1's fix makes `STOCK_RESERVED` recoverable, revisit whether the shared budget is still generous enough.)

---

## Verified-safe (hunts that came back clean)

- **Double-reserve:** `reserve-stock.handler.ts:149-153` — `findActiveByOrder` by (tenantId, orderId) returns the existing hold, asserts replay match, returns existing ids, no second decrement. Solid.
- **Double-charge (steady state):** REJECT_DUPLICATE rejects a duplicate start whether OPEN or CLOSED within retention (`temporal-workflow-gateway.adapter.ts:51-67`). No second charge. (The cost of that guarantee is C1.)
- **Advisory lock:** non-blocking `pg_try_advisory_lock` (`advisory-lock.ts:27-33`), `ran:false` clean skip, dedicated connection always released, distinct key 5001 vs outbox 4001-4004. Serializes multi-replica AND overlapping ticks on one replica. Good.
- **Never-throw / test guard:** `sweep()` try/catch (`:110-115`), per-saga try/catch (`:152-192`), timer `unref()`, `NODE_ENV=test` disable (`:76-79`). Good.
- **Tenant scope:** `candidate.tenantId` from the raw `findNonTerminal` select; order load is tenant-scoped (`:158`); outbox append reads ambient tenant set by `tenantContext.run({tenantId: candidate.tenantId,...})` (`:178`). `order_id` is the global PK (`order-saga.orm-entity.ts:14`), so the tenant-less `recordReconcileAttempt` WHERE clause hits exactly one row — no cross-tenant fan-out. Correct tenant on the outbox row.
- **Re-drive command inputs:** `items`/`totalCents` loaded from the CURRENT order (`saga-reconciler.ts:45,53`), not stale/zero. `correlationId ?? randomUUID()` defensive fallback is sane (saga always carries the root id).
- **Migration:** `ADD COLUMN attempts integer NOT NULL DEFAULT 0` — PG11+ metadata-only add (no table rewrite) on a populated `order_saga`; reversible `down`; registered in the testcontainers DB (`order-test-database.ts:45`); no plan/backlog tokens in name. Good.
- **Metrics cardinality:** `redriven{state}` bounded to 3 values; `escalated` unlabelled. Fine (see M1 for the truthfulness caveat, not cardinality).
- **Atomicity:** outbox append + `recordReconcileAttempt` share one tx via the transactional-entity-manager getter (`typeorm-order-saga.repository.ts:36-38`, `:102`). Atomic.

---

## Recommended actions (priority order)

1. **C1** — payment re-drive can't recover a lost reply from a completed charge. Add a reply-replay path (or re-scope `STOCK_RESERVED` recovery to DLQ reply-replay) and correct the plan/docstrings. Blocking for the slice's stated purpose.
2. **H1** — guard the re-drive on current non-terminal state inside the tx; abort (don't emit) if the saga moved. Closes the cancelled-order stock-leak race.
3. **M1** — stop counting no-op re-drives as `redriven` (or split a no-op metric), especially until C1 is fixed.
4. **L1/L2** — document escalate-and-hold + retention-expiry constraints on the manual-replay follow-up; add an alert on `saga_reconcile_escalated_total`.

## Unresolved questions

1. Is `STOCK_RESERVED` recovery INTENDED to be command re-drive, or should it be DLQ reply-replay? C1's fix depends on the answer.
2. Confirm Temporal workflow retention for `charge-{orderId}` in prod config — needed to bound L2's real risk window.
3. Product intent on L1: leave inventory reserved for an escalated order, or auto-release after a hard deadline?

---

**Status:** DONE_WITH_CONCERNS
**Summary:** Recovery is correct for inventory-stage strands (`STARTED`/`COMPENSATING` re-emit their reply idempotently) but C1 — the payment stage — cannot recover a lost reply from an already-completed charge workflow (REJECT_DUPLICATE swallows the duplicate start without re-running `emitReply`), defeating the reconciler's headline purpose for `STOCK_RESERVED`; plus H1, a guard-less/read-before-tx race that can leak a stock hold onto a cancelled order.
**Concerns/Blockers:** C1 (Critical) invalidates a documented success criterion and a plan premise; H1 (High) is a real if low-probability permanent stock leak. Both have concrete fixes above. Downstream idempotency, advisory lock, tenancy, migration, and never-throw are verified solid.
