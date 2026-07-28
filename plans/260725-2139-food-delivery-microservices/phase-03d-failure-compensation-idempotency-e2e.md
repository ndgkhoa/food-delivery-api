# Slice 3d — Failure / compensation + idempotency e2e

Context: [phase-03.md](./phase-03-event-driven-backbone.md) · [phase-03c.md](./phase-03c-order-saga-events.md) · [phase-03b.md](./phase-03b-catalog-outbox-debezium-cqrs.md) · [development-workflow.md](./development-workflow.md)

## Overview
- **Priority**: P0 — proves the backbone's correctness claims; no new features, only guarantees.
- **Status**: Not started
- **Branch (example)**: `test/order-saga-compensation-e2e`
- **Brief**: End-to-end validation of the event-driven guarantees: forced payment failure compensates (stock released, order CANCELLED, no partial state); consumer killed mid-stream → on restart no duplicate side-effects; catalog write lands in the read model within seconds. This slice is mostly tests + any hardening they surface.

## Key insights
- Determinism is the enabler: payment stub fails on `PAYMENT_STUB_FAIL_AT_CENTS` (3c), so compensation is triggerable without randomness.
- Idempotency is asserted by **injecting duplicates** (redeliver a reply / restart a consumer) and asserting single-effect — not by inspecting code.
- Tests run against real infra (`core`+`messaging`) via testcontainers where feasible; the Debezium path (3b) needs compose (no Node Debezium testcontainer) — reuse the 3b compose harness.

## Requirements
**Carry-forward from 3a (review)**: the shared consumer has TWO silent skip paths that only `logger.error` today — an undecodable message (decode guard) and a handler that exhausts its retry budget. Add a **drop counter/metric** (and, if cheap, an `onPoison` hook) so a dropped saga command is observable, and cover BOTH paths in the stale-saga discoverability test.

**Carry-forward from 3c (review) — H1 is the TOP 3d item.** `runHandlerWithRetry` currently commits the offset after ≤`maxAttempts` retries on ANY handler error, so a **transient** DB/lock fault lasting longer than the retry budget permanently skips a saga reply → the saga strands (e.g. COMPENSATING forever, order stuck RESERVED, reserved stock never returned). **Decision to make in 3d (was reviewer Q1): the exhaustion policy must split by error kind** — a *decode* error stays skip-past (structurally unrecoverable, must never stall the partition), but a *handler* exhaustion on an idempotent consumer must NOT silently advance the offset. Route it to a **DLQ topic + commit past** (partition keeps moving, message preserved for replay) rather than block-and-redeliver (which a truly-poison handler error would turn into a permanent partition stall). Pair the DLQ with the drop counter above. Related lower-priority 3c items to fold in here: **M2** wire the `attempts` outbox column (increment on publish failure → publish-failure visibility, feeds the DLQ/reaper); **M3** propagate one `correlation_id` across a saga's commands+replies (today each `outbox.append` mints a fresh id, so a saga can't be traced end-to-end) — thread the triggering event's correlation id into the emitted command. A basic **saga reaper/timeout** (sweep stranded sagas) is the pre-DLQ safety net; full Temporal-backed timeouts stay P5.
**Functional**: compensation path; idempotent redelivery; CDC→read-model propagation; stale-saga discoverability.
**Non-functional**: tests deterministic + repeatable; no oversell/double-charge under duplicate delivery; polls bounded by timeout with clear failure output.

## Test matrix
| # | Scenario | Setup | Assert |
|---|----------|-------|--------|
| 1 | Happy saga | place order, valid stock | polls → CONFIRMED; stock decremented; saga COMPLETED; 1×PaymentSucceeded effect |
| 2 | Payment failure → compensation | order total = `PAYMENT_STUB_FAIL_AT_CENTS` | polls → CANCELLED; stock **released** back to pre-order; saga COMPENSATING→CANCELLED; no charge retained |
| 3 | Stock failure → cancel | stock insufficient | polls → CANCELLED; no charge ever emitted; saga STARTED→CANCELLED |
| 4 | Duplicate reply (idempotent saga) | redeliver `StockReserved` twice (re-publish) | exactly one payment.charge emitted; saga transitions once (version guard + processed_events) |
| 5 | Consumer kill mid-stream | kill inventory consumer after reserve, before reply committed / restart | on restart: reserve not double-applied (idempotent by orderId + dedupe); saga still converges to terminal state |
| 6 | Duplicate command delivery | redeliver `ReserveStock` twice | stock reserved once (P2 partial-unique ACTIVE index + dedupe); one reply effect |
| 7 | CDC → read model | update a restaurant via HTTP | within N s, read-model `GET` reflects change; `catalog.events` carries correct headers/key |
| 8 | Concurrency + failure mix | 100 orders on stock=10, some at fail-amount | ≤10 CONFIRMED, rest CANCELLED, zero oversell, released stock consistent |
| 9 | Stale-saga discoverability | drop a reply (simulate lost) | order remains PENDING and is listed by the sweep worklist (`status=PENDING`); documents P5 timeout follow-up |

## Related code files (to create)
- `apps/order-e2e/src/*saga-compensation*.e2e-spec.ts` — scenarios 1–6, 8, 9 (owns the saga e2e; boots order+inventory+payment+kafka).
- `apps/catalog-e2e/src/*cdc-read-model*.e2e-spec.ts` — scenario 7 (compose `core`+`messaging` with Debezium).
- `libs/shared/testing/src/*` — helpers: `pollOrderUntil(status, timeout)`, `republishRecord(topic, record)` (duplicate injection), `restartConsumer(...)`, kafka test bootstrap. Extend existing testing lib.
- Any hardening files surfaced (e.g. saga transition guards, sweep query) land in the owning service, not in tests.

## Implementation steps
1. Extend `shared/testing` with poll/duplicate-inject/consumer-restart helpers + a `core`+`messaging` compose bring-up (or testcontainers Kafka where Debezium isn't needed).
2. Order saga e2e: scenarios 1–6, 8, 9. Use `PAYMENT_STUB_FAIL_AT_CENTS` for #2; craft stock for #3/#8; use `republishRecord` for #4/#6; kill/restart for #5.
3. Catalog CDC e2e: scenario 7 against the 3b compose harness.
4. Fix any correctness gaps the tests expose (compensation ordering, dedupe scope, version conflicts) in the owning service.
5. Run the full matrix in CI (`nx affected -t test` picks up order/catalog/inventory/payment). Ensure serial execution where a shared broker/port is used.
6. Update plan todos/status + mark phase-03 Status → In progress/Done as slices land; BEFORE push.

## Todo
- [ ] `shared/testing` helpers (poll, duplicate-inject, consumer-restart, kafka bootstrap)
- [ ] saga e2e scenarios 1–6, 8, 9 green
- [ ] catalog CDC→read-model e2e (scenario 7) green
- [ ] correctness gaps surfaced by tests fixed in owning services
- [ ] full matrix green in CI (serial where shared infra)
- [ ] biome/cruiser/knip clean; plan updated before push

## Success criteria
- All 9 matrix rows pass deterministically, repeatably.
- No oversell, no double-charge, no partial state under any failure/duplicate injection.
- Catalog write → read model within the asserted bound; connector RUNNING.
- Stranded-saga worklist query returns the dropped-reply order (P5 timeout follow-up documented).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Flaky async timing in tests | M×M | Bounded polling with generous timeout + clear diagnostics; deterministic stub; serial infra |
| Debezium path untestable in-process | M×M | Reuse compose harness from 3b; assert via HTTP + topic read, not internals |
| Consumer-kill test races | M×M | Kill at a defined offset boundary; assert convergence, not exact interleaving |
| CI RAM (core+messaging) | L×M | Bring up only needed profiles; heap caps; serial suites |

## Security considerations
- Tests assert tenant isolation holds across the async path (a tenant-A order never touches tenant-B stock/read-model).
- No real secrets/PII in test events.

## Next steps
Phase 3 complete → mark plan.md P3 ✅. Unblocks P4 (search consumes `catalog.events`), P5 (payment→Temporal + DLQ + saga timeouts replaces the stale-saga note), P6 (analytics/review consume order events).
</content>
