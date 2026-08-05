# Slice 3d Red-Team Review — DLQ + Saga Reaper + Correlation + Attempts + E2E Matrix

Scope: `git diff develop...HEAD` (2 code commits + plan). Runtime already proven green — this is a
correctness/robustness hunt on the new hardening, with special focus on the failure-handler's own
failure modes and on e2e assertions too weak to catch a regression.

## Verdict
No Critical defects. One **High** (deliberate-tradeoff) message-loss window in the DLQ failure branch,
plus several **Medium** test-rigor gaps where the named scenario does not exercise the code it claims.
The core mechanics (commit-after-DLQ, correlation threading, idempotency, reaper selection, attempts)
are correct.

---

## HIGH

### H1 — DLQ-publish failure silently loses a saga command/reply (message lost → permanent strand)
`kafka-consumer.ts:95-118`, `message-processing.ts:125-129`

Flow on handler-exhaustion: `dropCounter.record` → `deadLetter(...)` → `commit()`. `publishDeadLetter`
wraps the produce in try/catch and **swallows** any error (never rethrows), so `consumeOneMessage`
proceeds to `commit()` and advances past the message.

Sequence → bad outcome: broker/DLQ hiccup at the moment of a dead-letter (e.g. `<topic>.dlq` partition
unavailable, ACL/config error, produce timeout) → publish rejects → caught+logged → **offset still
committed** → the saga reply/command is gone. The saga stays non-terminal with a reserved stock hold
outstanding. In this slice the only safety net is the reaper, which is **report-only** (no
auto-recovery), so the outcome is a permanently stranded saga + leaked hold requiring manual replay —
except the message it would replay from is not in the DLQ.

This is documented as an accepted tradeoff ("vs a permanent partition stall"). But note the DLQ shares
the *same broker* as the source topic, so a DLQ outage almost always coincides with a source outage —
meaning "block until DLQ succeeds" (bounded retry before commit) would **not** reduce practical
availability (the partition is stalled by the broker being down anyway) yet would eliminate the loss
window. The current best-effort-then-commit only loses a message in the narrow case where the DLQ
produce fails while the offset commit path still works.

Recommendation: for saga topics, retry the DLQ publish a bounded number of times (or block until the
broker recovers) *before* committing; only commit-and-drop after the bounded budget is exhausted. At
minimum, escalate a DLQ-publish failure to the reaper/attempts visibility path so the lost message is
recoverable, not just logged.

Secondary (same finding): `dropCounter.record` runs *before* `deadLetter`, so `getDropCounts()` counts
messages we *decided* to drop, not messages *confirmed written to the DLQ*. On a DLQ-publish failure the
counter says "5 dropped" but only 4 are replayable — misleading for an operator draining the DLQ. Record
the count only after the publish resolves (or record a separate "dlq-publish-failed" reason).

---

## MEDIUM

### M1 — Reaper query fetches ALL in-flight sagas every sweep; index comment overstates
`typeorm-order-saga.repository.ts:94-109`, `1753747900000-add-order-saga-reaper-index.ts:3-8`

`findNonTerminal()` filters only by `state IN (...)` — no `updated_at` predicate, no tenant scope, no
LIMIT. Every non-terminal saga (i.e. every actively in-flight order across all tenants) is pulled into
the order process each sweep (default 30s) and filtered in memory by `selectStrandedSagas`. The migration
comment claims the scan is `state IN (...) AND updated_at < threshold` and that the `(state, updated_at)`
index lets it "seek straight to the oldest rows" — but the query never pushes the `updated_at` predicate,
so the index only serves the state filter and the age filter happens in JS. At volume this is a full read
of all in-flight sagas on a timer. Report-only, so not a correctness bug, but a scalability footgun +
a comment that misrepresents the query. Fix: push `updated_at < :threshold` into the WHERE clause (the
index already supports it) and add a LIMIT.

### M2 — The DLQ-publish-failure branch (the failure-of-the-failure-handler) has NO test
`kafka-consumer.spec.ts` (makeConsumeDeps `deadLetter` always resolves)

Every `consumeOneMessage` test injects a `deadLetter` that resolves. There is no test where the DLQ
publish **rejects**, so the single most safety-critical path (H1 — "message lost but offset still
advances, never throws out of eachMessage") is unverified. Also note `consumeOneMessage` calls
`await deps.deadLetter(...)` with **no try/catch of its own** — the "never throws" guarantee rests
entirely on `publishDeadLetter`'s internal swallow. If any future caller wired a `deadLetter` that can
throw, `commit()` is skipped and the exception escapes eachMessage → partition re-stall. Add a unit
test: rejecting `deadLetter` ⇒ `commit` still called exactly once and `consumeOneMessage` resolves.
(Ideally also move the swallow into `consumeOneMessage` so the invariant is enforced at the layer the
test covers, not only in the subscriber's private method.)

### M3 — E2E "listsAStrandedSagaInTheReaperWorklist" does not exercise the reaper
`order-saga-compensation.e2e-spec.ts:159-185`

The test seeds a stale saga then runs a **hand-written raw-SQL query inline** and asserts it contains the
order. It never calls `TypeOrmOrderSagaRepository.findNonTerminal()` or `selectStrandedSagas()` or
`SagaReaperProvider.sweep()`. So a regression in the repo's column-alias mapping (`saga.order_id AS
order_id` etc.), the non-terminal state set, or the pure selection rule would **not** be caught by this
e2e — only by the unit specs (which do cover selection well). The test name overpromises. It also
hardcodes `interval '60 seconds'` rather than reading `SAGA_REAPER_TIMEOUT_MS`, so a config/query
divergence is invisible. Fix: invoke the actual reaper path (or at least `findNonTerminal`) and assert on
its output.

### M4 — Idempotency e2e proves the ledger short-circuit, not the dangerous crash window
`order-saga-idempotency.e2e-spec.ts:33-55`, `order-saga-compensation.e2e-spec.ts:99-121`

The automated "replay after crash" test re-publishes the ReserveStock command **after the order already
CONFIRMED** — i.e. the `processed_events` marker is already committed. That exercises the ledger dedupe
(marker present → skip), which is the *easy* path. The genuinely dangerous window is a crash **between
the reserve effect committing and the `processed_events`+reply tx committing** (marker absent → runEffect
re-runs → correctness depends solely on the ACTIVE-hold gate in reserve). A regression that broke the
hold gate would still pass this automated test because the ledger catches the dup. That property is only
covered by the manual "docker compose restart inventory" step documented in the header. Recommend an
automated variant that re-injects the command with the ledger marker absent (or asserts the reserve
use case's idempotency directly) so the hold-gate guarantee is regression-protected.

---

## LOW

### L1 — Lazy DLQ-producer init race leaks a connection
`kafka-consumer.ts:86-93`

`deadLetterProducer()` does `if (!this.dlqProducer) { new; await connect(); this.dlqProducer = ... }`.
The order service shares ONE `KafkaConsumerSubscriber` singleton across two independent consumers
(`inventory.replies` + `payment.replies`), whose `eachMessage` callbacks run concurrently. If both
dead-letter for the first time simultaneously, both see `null`, both construct + `await connect()`, and
the second assignment orphans the first producer — connected but never disconnected (`onModuleDestroy`
closes only the last). Resource/connection leak, not message loss; needs simultaneous first-ever
dead-letters on two topics. Fix: memoize the in-flight init promise (`this.dlqProducerPromise ??= ...`).

### L2 — `strandedTotal` over-counts persistent strands
`saga-reaper.provider.ts:68-74`

`strandedTotal += stranded.length` every sweep. A saga that stays stranded is re-counted on every tick,
so the logged "N total" is cumulative *sightings*, not distinct stranded sagas — misleading as a metric.
Cosmetic (observability only).

### L3 — DLQ topics have no retention/cleanup; `*.dlq` source would recurse
`kafka-consumer.ts:66-83`, `dead-letter.ts:9-11`

DLQ topics are auto-created and never pruned (ops concern, not correctness). And if a service ever
subscribed a topic already ending in `.dlq`, `deadLetterTopic` would produce `.dlq.dlq` — no such path
exists today; note only.

---

## Verified correct (do not re-litigate)

- **Commit ordering (H1's core is the only gap):** offset is committed AFTER the DLQ publish resolves on
  BOTH drop paths (undecodable `message-processing.ts:115-116`, handler-exhausted `:127-129`); success
  path commits WITHOUT any DLQ send — a handled message can never also be dead-lettered (no double).
- **DLQ producer lifecycle:** connected once + reused (`deadLetterProducer`), disconnected on module
  destroy (`onModuleDestroy`), idempotent+acks=all. Publishes `X → X.dlq`; consumers never subscribe DLQ
  topics, so no recursive `X.dlq.dlq`. Original bytes (key/headers/value base64) + source coords + reason
  preserved for replay.
- **Correlation integrity:** root minted once in `place-order.handler.ts:104`; threaded via
  `envelope.correlationId` through both reply handlers into the next command
  (`handle-inventory-reply:76-78`, `handle-payment-reply:79`); inventory/payment reply factories carry the
  incoming command's correlation; `entry.correlationId ?? randomUUID()` fallback fires only on
  null/undefined. `decodeHeaders` fails closed on an empty `x-correlation-id` (`event-envelope.ts:57-62`)
  → an empty correlation can never reach a handler (it's dead-lettered), so the saga path is always
  non-null and the fallback only mints for genuinely-rootless emits. No emit site drops it to a fresh uuid
  mid-saga.
- **attempts wiring:** increments exactly the failed batch's ids (`outbox-relay.ts:107`), via a separate
  DB write (`.increment`) independent of the failed Kafka producer, errors swallowed+logged
  (`recordFailedAttempts`), backoff bounded to `maxBackoffMs` (no busy loop). No unbounded tight retry.
- **Reaper selection:** report-only, mutates nothing; catches sweep errors; `unref()` timer; `NODE_ENV=test`
  guard matches the relays. `selectStrandedSagas` excludes terminal states and any saga updated within the
  window (active sagas whose `updated_at` bumps on each `transition()` are never false-flagged); boundary
  is strict `<` (no off-by-one). Migration `down()` uses `DROP INDEX IF EXISTS`; no plan tokens.
- **Idempotency:** both reply handlers dedupe by `eventId` (`processed_events`) AND guard on saga state,
  so redelivery is a no-op; reserve is idempotent via the atomic conditional decrement gated on an ACTIVE
  hold. E2E duplicate tests re-inject REAL Kafka records with the event-id header unchanged
  (`saga-kafka-support.ts:58-81`) — genuine redelivery, not a fake.
- **E2E assertion strength (the ones that matter):** #1 asserts stock returns to the exact pre-order
  level (5) AND no `handler-exhausted` DLQ record; #2 asserts 0 (never reserved); the 100-concurrent mix
  asserts exactly 10 CONFIRMED / 90 CANCELLED and zero oversell on BOTH items with the declined leg's hold
  fully returned. These are real, not trivially green.
- **Conventions:** no `phase`/`H#`/`M#`/`F#`/`3d`/`slice`/`red-team` tokens in code, migrations, or test
  names; all new files < 200 lines; hexagonal boundaries intact (DLQ producer/counter live in
  shared-messaging; order imports neither inventory nor payment). `attempts` column pre-existed in the
  create-outbox migrations — no schema break, no new migration needed for it.

---

## Unresolved questions

1. Is there a downstream owner (P5?) that reads `outbox.attempts` to quarantine/skip a poison outbox row?
   Today a poison row head-of-line-blocks the entire drain (`fetchUnpublished` orders by `created_at ASC`),
   `attempts` climbs, but nothing acts. This is defensible (never drop a saga command) and asymmetric with
   the consumer DLQ by design — but the code comment claims the row is "visible for a reaper to escalate"
   and no such reaper reads `attempts` yet. Confirm the escalation path exists somewhere or soften the
   comment.
2. For saga topics specifically, is H1's DLQ-publish-failure message-loss window acceptable given the
   reaper is report-only (no auto-recovery this slice)? Given the DLQ shares the broker with the source,
   block-until-DLQ (bounded) would close the window at ~zero availability cost — is that a deliberate
   deferral or an oversight?

**Status:** DONE_WITH_CONCERNS
Summary: DLQ commit-ordering, correlation threading, idempotency, reaper selection, and attempts are all
correct; the real gaps are the DLQ-publish-failure loss window (H1, documented tradeoff) and four
test-rigor holes where the named scenario doesn't exercise the code it claims (M2 DLQ-failure branch
untested, M3 reaper e2e re-implements the query, M4 idempotency e2e tests the ledger not the hold gate).
Most important finding: **H1 — a DLQ-publish failure commits past a lost saga message, stranding the saga
with a leaked stock hold and no auto-recovery; for saga topics consider block-until-DLQ since source and
DLQ share the broker.**
