# Red-Team Review — Slice 3a: Kafka Messaging Foundation (PR #10)

Branch `feat/kafka-messaging-foundation` → `develop`. Reviewed diff only.
Scope: `libs/shared/messaging/*`, `infra/docker-compose.yml` (kafka), `.env.example`, `apps/messaging-e2e/*`.
Verified externally (not re-checked): testcontainers e2e green, compose broker boots + host client on :9092, biome/cruiser(0)/knip/tsc/20 unit tests green.

Vendor behavior verified against `node_modules/@confluentinc/kafka-javascript@1.10.0` source (not assumed).

## Verdict
One **Critical** liveness defect that will break 3b as written. Rest are Medium/Low design notes. Producer idempotence, partitioner determinism, and manual-commit at-least-once are all implemented correctly (verified against vendor source).

---

## CRITICAL

### C1 — Unguarded envelope decode stalls the partition forever (poison pill / head-of-line block)
`kafka-consumer.ts:74-82` (`decodeMessage`) + `:116-131` (`eachMessage`).

`decodeMessage` runs BEFORE `runHandlerWithRetry`. It calls `decodeHeaders` (throws `MissingEventHeaderError` on any absent `x-*` header, `event-envelope.ts:53-55`) and `JSON.parse` (throws on corrupt payload, `:80`). A throw here propagates out of `eachMessage`. Confirmed in vendor `_consumer.js#messageProcessor` (l.1331-1365): the throw is caught, `eachMessageProcessed` stays false, the consumer `seek()`s back to the same offset and redelivers — **indefinitely**. The retry/skip poison-message budget only wraps the handler, never decode.

Concrete failure:
- **3b (guaranteed):** Debezium/Kafka-Connect CDC messages are produced by Connect, not this lib's producer, so they carry none of the `x-event-id`/`x-tenant-id`/`x-occurred-at` envelope headers. Any consumer built on `KafkaConsumerSubscriber` pointed at a CDC topic throws on message #1 and the partition is stuck forever in a tight fail→seek-back→refetch loop (CPU + log flood).
- **Any topic:** one malformed/corrupt message permanently blocks its partition.

This directly contradicts the code's own doc invariant ("this shared substrate must not stall a partition forever on one poison message", `:39-42`).

Fix: move `decodeMessage` inside the same bounded protection as the handler — on decode failure log + commit-skip (consistent with the handler-exhausted path) or route to a DLQ. Do not let a decode throw escape `eachMessage`.

---

## HIGH

### H1 — Poison-message "skip" is silent, unbounded data loss for the saga
`kafka-consumer.ts:59-64` (swallow after maxAttempts) + `:128-130` (commit runs regardless).

After `maxAttempts` the error is logged and swallowed, then the offset is committed (`message.offset + 1`) → the event is dropped (at-most-once). Documented as intentional (DLQ deferred). But for **3c's order saga**, a dropped event = the saga stalls with no compensation and no redelivery, and nothing downstream knows. `logger.error` is the only signal.

This is an accepted-risk that **3d must close** with a real DLQ. Minimum for now: make the drop alertable (dedicated metric/counter, not just a log line) so a stuck saga is detectable. Flagging because a foundational substrate that silently drops is the kind of thing that ships and bites in prod.

---

## MEDIUM

### M1 — Outbox double-publish window; SKIP LOCKED comment overstates protection
`outbox-relay.ts:17-20` (port), `:80-94` (`runOnce`).

`fetchUnpublished` and `markPublished` are separate methods → separate transactions. `SELECT ... FOR UPDATE SKIP LOCKED` row locks release when fetch's tx ends, so between fetch and markPublished a second relay replica — or a manual `runOnce()` racing the timer `tick()` — can re-claim and re-publish the same rows. Correctness is saved only by consumer dedupe (`IdempotentConsumer`), NOT by SKIP LOCKED. The comment "concurrent relay instances never double-claim a row" (`:14-15`) is false as the port is shaped.

For 3b: either (a) accept at-least-once + rely on dedupe (fine — but fix the misleading comment), or (b) reshape the port so claim+mark share one tx (or a `claimed_at`/status column) so SKIP LOCKED actually holds.

### M2 — IdempotentConsumer atomicity depends on unenforced caller wiring
`idempotent-consumer.ts:33-48`.

`markProcessed(tx, eventId)` receives the tx; `work: () => Promise<TResult>` does not. Atomicity ("recorded" and "effect" commit/rollback together) relies entirely on the caller closing `work` over the *same* tx. If a caller's `work` accidentally uses a different pooled connection, the dedupe row and the effect commit independently → a later duplicate can re-run the effect (double effect), or the effect commits while the dedupe row rolls back. Foundational footgun for 3b/3c handlers.

Fix: pass the tx into work — `work: (tx: TTx) => Promise<TResult>` — so the effect is structurally forced onto the same tx.

---

## LOW

### L1 — Codec fails closed on missing headers but not empty ones
`event-envelope.ts:51-57`. An empty-string `x-tenant-id` decodes to `tenantId: ''` (a zero-length Buffer is not `undefined`, so no throw), and the consumer runs the handler in tenant scope `''`. Producer-controlled today, but for a fail-closed tenant-security codec, reject empty required values too.

### L2 — OutboxRelay timer not `unref()`'d
`outbox-relay.ts:97`. Pending `setTimeout` keeps the event loop alive between ticks; clean exit relies on the caller invoking `stop()` (the lib doesn't self-wire lifecycle). Server-fine, but a forgotten `stop()` hangs shutdown/tests. Consider `.unref()`.

### L3 — Per-message synchronous commit is a throughput ceiling
`kafka-consumer.ts:128-130`. `commitOffsets` on every message = one broker round-trip per message. Correct, but a bottleneck for 3b's high-volume CDC fan-out. Note for later tuning (commit every N / periodic).

### L4 — e2e broker image ≠ compose broker image
`apps/messaging-e2e/...:19` uses `confluentinc/cp-kafka:7.9.1` (testcontainers constraint) while compose ships `apache/kafka:4.3.1`. Green e2e does not exercise the shipped broker config. Compose reachability was verified manually — keep that manual check, or add a smoke test against the compose image.

---

## Verified correct (do not re-flag)
- **Idempotence + acks=all:** `kafka-producer.ts:53` `{ idempotent: true, acks: -1 }` → vendor `_producer.js:196-213` sets `enable.idempotence=true` and `acks=-1`. Retries default 5, tx-timeout defaults set. Correct.
- **Partitioner determinism:** vendor `_producer.js:175` hardcodes `partitioner = 'murmur2_random'` in kafkaJS-compat mode = Java/Debezium-compatible murmur2. So same `aggregateId` key → same partition across THIS producer AND 3b's Debezium producer. Key passed through as Buffer (`:34`). Cross-producer per-key ordering holds.
- **publishBatch not fire-and-forget:** `sendBatch` awaits delivery reports; any message failure rejects → outbox left unmarked → safe re-drain. Partial-batch failure = at-least-once (dedupe handles). Correct.
- **Manual commit / at-least-once:** `autoCommit:false` → vendor `_consumer.js:612-613` sets `enable.auto.commit=false`; stored offset is not broker-committed. Commit happens AFTER the handler, offset = `message.offset+1` (correct next-offset). Crash between handler success and commit → redelivery → dedupe. No commit-before-handler path.
- **Tenant scope from headers:** handler runs inside `tenantContext.run({ tenantId: envelope.tenantId, ... })` — never trusts payload for tenant identity. Port signature matches (`tenant-context.port.ts`).
- **IdempotentConsumer duplicate handling:** unique-violation → `DuplicateEventError` → skip work, return undefined, no throw; non-duplicate errors and work errors propagate (roll back caller tx). No double-effect window given correct tx wiring (see M2).
- **Boundaries:** lib imports only `@confluentinc/kafka-javascript`, `@food-delivery-api/shared-tenancy`, `@nestjs/common` — no app code. `kafka-client.ts` cycle-break (token in its own file) is justified. `MessagingModule.forRoot` wiring correct.
- **Compose:** dual-listener CONTROLLER/INTERNAL/HOST coherent; INTERNAL advertised by container name for 3b Debezium, HOST as localhost:9092; RF/ISR=1 for single broker; healthcheck via `kafka-topics.sh --list` on localhost:9092 valid. (No data volume → ephemeral; fine for dev/e2e.)
- **Header codec:** round-trips eventId/eventType/aggregateId/tenantId/correlationId/occurredAt losslessly; accepts Buffer or string; takes first of repeated; throws on missing (fail-closed).

---

## What bites 3b/3c specifically
- **C1** blocks 3b outright: Debezium CDC topics have no `x-*` envelope headers → `KafkaConsumerSubscriber` stalls on message #1. Must fix before 3b (guard decode; likely need a header-mapping SMT on the Connect side too).
- **M1** applies the moment 3b runs >1 relay replica — fine only because dedupe exists; fix the false comment.
- **M2** will double-apply effects in 3b/3c if any handler wires `work` to the wrong connection — harden the API now while there are zero callers.
- **H1** makes 3c sagas silently stall on a dropped event; 3d's DLQ work must close it.

## Unresolved questions
1. C1 fix intent: on decode failure, skip-commit (consistent with handler poison path) or DLQ from day one? Affects whether 3b needs a Connect-side header SMT or a lenient decoder for CDC topics.
2. Is H1's silent drop acceptable through 3c, or should a drop-counter metric land now so stuck sagas are observable before 3d?
3. M1: intended outbox concurrency model — single relay instance, or N replicas relying on dedupe? Determines whether the port needs a shared claim tx.
