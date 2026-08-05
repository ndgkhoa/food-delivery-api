# Slice 5b Notification — Adversarial Red-Team Review

Branch `feat/notification-service`. Scope: `apps/notification/**`, shared libs it reuses (`libs/shared/messaging`). Static gates already pass; this is a logic/correctness/data-integrity red-team. Live-verified items (happy path, idempotent redelivery, DLQ park) were NOT re-litigated — only new defects those tests masked.

Overall: architecture is sound and mirrors the delivery/payment patterns faithfully. Idempotency-by-event-id, tenant scoping, DLQ observability, and consumer crash-resistance are correctly implemented. **One Critical silent-loss path** exists that the live happy-path test could not surface, plus a set of lower-severity accuracy/robustness gaps.

---

## CRITICAL

### C1 — Silent (partial or total) notification loss when an enqueue fails after the dedupe commit
**Files:** `application/dispatch-order-event.handler.ts:104-123`; interacts with `libs/shared/messaging/src/message-processing.ts:37-67` (handler retry) and `infrastructure/queue/bullmq-notification-queue.adapter.ts:39-47`.

**Root cause (broader than the documented "crash gap"):** the transaction commits `processed_events` + PENDING rows (line 104-108), and the BullMQ enqueue loop runs *after* commit (line 114-123). The plan documents this as an accepted **crash**-only gap needing a polling outbox. It is actually reachable **without any crash**, via the shared consumer's own retry:

Concrete scenario (no crash required):
1. Attempt 1 of `runHandlerWithRetry`: `dispatch.execute` commits the tx (processed_events + 3 PENDING rows).
2. The very first `queue.enqueue('email', …)` **throws** — e.g. Redis returns `OOM command not allowed` under `maxmemory`, `WRONGTYPE`, or the connection is closing during a rolling deploy. (Transient connection blips instead *hang* because `maxRetriesPerRequest: null`, which widens the crash variant — see below — but a Redis *error reply* rejects synchronously.)
3. The thrown error propagates out of `dispatch.execute` → `runHandlerWithRetry` catches it → **attempt 2**.
4. Attempt 2: `IdempotentConsumer.runOnce` → `markProcessed` hits the committed `processed_events` row → `DuplicateEventError` → `runOnce` returns `undefined` → `created` is falsy → `if (!created) return` (line 109-112). **The enqueue loop is skipped entirely.**
5. Handler returns `ok` → Kafka offset commits.

**Outcome:** 3 rows stranded `PENDING` forever, **zero** BullMQ jobs, **zero** emails, **no DEAD row, no DLQ job** — completely invisible except a `PENDING` row nobody scans. If the throw happens mid-loop (email enqueued, sms throws) it is a *partial* loss (email sent, sms+push lost). This violates the slice's headline guarantee ("never silently dropped").

**Crash variant, made worse by config:** the producer connection uses `maxRetriesPerRequest: null` (`bullmq-notification-queue.adapter.ts:28`). When Redis is *down* (not erroring), `queue.add` does not reject — it blocks indefinitely, so the Kafka handler `await`s forever and the partition stalls with the tx already committed. A pod restart (rolling deploy, OOMKill, node drain) during that window → redelivery is deduped → same silent loss. So the "microsecond crash gap" is in practice held open for the entire duration of any Redis outage.

**Why the live test missed it:** the DLQ test forced a *send* failure (Mailpit down) — that path works (job enqueued, worker retries, DEAD+DLQ). It never forced an *enqueue* failure or a restart between commit and enqueue.

**Fix options (pick one):**
- **Transactional outbox (correct fix):** write the per-channel job intents into an outbox table *inside the same tx* as `processed_events`+rows; a relay drains outbox → BullMQ with at-least-once. Enqueue can then never be "lost" relative to the dedupe marker.
- **Reconciler (cheap, good enough for this slice):** a periodic/startup scan for rows `status='PENDING' AND created_at < now()-interval` with no active BullMQ job (jobId=id), and (re)enqueue them. `jobId=notificationId` already makes re-enqueue idempotent, so this is safe.
- **Minimum:** at least make the enqueue loop failure *not* get deduped away — e.g. move `markProcessed` to only be considered "done" once jobs are enqueued (harder to keep atomic), or catch enqueue errors and leave the Kafka offset uncommitted *without* having committed `processed_events` first. The outbox/reconciler is cleaner than fighting the ordering.

If the team consciously accepts this for the learning slice, the acceptance note in `dispatch-order-event.handler.ts:57-66` must be widened: it currently claims only a *crash* triggers it and only an outbox closes it — it is also triggered by a plain transient enqueue error through the built-in retry, with no crash.

---

## HIGH

### H1 — Duplicate real send on worker crash between send success and `markSent` (at-least-once channel, no idempotency key)
**Files:** `application/send-notification.handler.ts:27-38`; `interface/queue/notification.worker.ts:50-54`.

`SendNotificationHandler.execute` sends (`channels[…].send`) then `markSent`. If the worker process dies (or the job stalls / lock is lost) *after* the SMTP `sendMail` resolves but *before* `markSent`, the job is neither completed nor failed → BullMQ re-runs it → the email is **sent again**. There is also **no status guard**: `execute` never checks `notification.status === 'SENT'` before sending, so any BullMQ re-delivery of an already-sent job re-sends. `removeOnComplete: true` bounds this to the stalled/crashed-mid-attempt window, but with a real provider that window = duplicate customer emails/SMS.

This is a *different* double-send vector than the Kafka-event idempotency the spec guarantees (that one — `processed_events` — is solid). Acceptable for Mailpit dev; call it out before real Twilio/FCM/SES land.

**Fix:** guard at the top of `execute` — `if (notification.status === 'SENT') return;` (reduces, doesn't eliminate, since a crash before `markSent` leaves status PENDING). Full fix needs a provider-side idempotency key (most providers support one) keyed on `notificationId`.

---

## MEDIUM

### M1 — DEAD row + DLQ park are not atomic; a Redis park failure yields a DEAD row with no parked job
**File:** `application/handle-send-failure.handler.ts:46-47`.

`markDead` (Postgres) runs, then `dlq.park` (Redis). If `park` throws, the worker's `failed` listener only logs (`notification.worker.ts:61-63`). Result: a `DEAD` row exists but **no `notify-dlq` job** — the replay payload (incl. `data.orderId`) is lost; only the row's channel/recipient/error survive. The plan's "DEAD row + DLQ job always together" invariant does not hold under a Redis fault at park time. (The reverse — parked job without DEAD row — cannot happen given the ordering.)

**Fix:** either persist enough on the DEAD row to fully replay (store the job payload/`data` on the row), or retry `park` before giving up, or record the park outcome. Low blast radius but breaks the stated observability guarantee.

### M2 — `data.orderId` is the only body content, but `bodyFor`/`subjectFor` silently degrade on unknown type
**Files:** `domain/notification/notification-copy.ts:18-26`; `application/dispatch-order-event.handler.ts:86-90`.

Not a live bug today (consumer pre-filters to CONFIRMED/CANCELLED), but `bodyFor` falls back to `Update for your order (${type})` and `subjectFor` to `Order update` for any unmapped type. If a future `NOTIFICATION_TYPE` mapping is added in the dispatcher but the copy map is not, customers get a generic email with no error surfaced. Consider making an unmapped type throw (fail loud) rather than send a degraded message, since sends are hard to recall.

---

## LOW

### L1 — DEAD row under-reports attempts by one (shows 4, actually retried 5) — the "attempts=4 vs MAX=5" observation
**Files:** `application/handle-send-failure.handler.ts:33-47`; `infrastructure/persistence/repositories/typeorm-notification.repository.ts:52-54`.

Not an off-by-one in *retries* — the service genuinely attempts `NOTIFY_MAX_ATTEMPTS`(5) times. Trace: BullMQ (`attempts: 5`) emits `failed` with `attemptsMade` = 1,2,3,4,5. `HandleSendFailure` marks FAILED with `attempts=attemptsMade` while `attemptsMade < 5`, so the last FAILED write records `4`. On the 5th failure (`attemptsMade=5`, not `< 5`) it calls `markDead(id, error)` — which **does not write `attempts`** (line 52-54 SETs only status+error). So the column stays frozen at the last FAILED value, `4`, while 5 attempts actually occurred. Purely an observability inaccuracy.

**Fix:** `markDead(id, attemptsMade, error)` and include `attempts` in the update SET. (Depends on BullMQ reporting `attemptsMade=5` on the terminal failure, which the live DEAD+DLQ result confirms for 5.81.2.)

### L2 — Belt-and-suspenders `notifications` unique(event_id,channel) violation is uncaught and would DLQ the event
**Files:** `infrastructure/persistence/repositories/typeorm-notification.repository.ts:31-37`; `entities/notification.orm-entity.ts:20-21`.

If `createPendingBatch` ever hits `uq_notifications_event_channel` (23505) — only possible if the two dedupe tables diverge, not in normal flow — it is *not* translated (unlike the `processed_events` store which catches 23505 → `DuplicateEventError`). It would bubble, roll back the tx (including `processed_events`), exhaust the handler retry budget, and dead-letter the event to `order.events.dlq`. No crash-loop (shared consumer bounds it), but the "secondary" guard produces a DLQ'd event rather than an idempotent no-op. Consider catching 23505 here too and treating as already-created.

### L3 — Recipient PII (phone/pushToken) logged at info level; PII may land in `error` column at rest
**Files:** `infrastructure/channels/log-sms.channel.ts:17`, `log-push.channel.ts:17`; `typeorm-notification.repository.ts:48,53`.

Stubs log `recipient` (synthetic today). With real Twilio/FCM this logs customer phone numbers / push tokens at info level. Separately, a provider `error` string can embed the recipient (e.g. SMTP `550 no such user <email>`) and is persisted to `notifications.error`. Fine for the stub slice; flag for the real-provider swap (redact recipient in logs; consider truncating stored error).

### L4 — `RecipientResolverStub` phone can collide / be malformed for non-numeric userIds
**File:** `application/recipient-resolver.stub.ts:17-26`.

`userId.replace(/[^0-9]/g,'').padEnd(7,'0').slice(0,7)` → a UUID userId with no digits yields `+15550000000` for *every* such user, and different userIds can map to the same phone. Harmless (stub, deferred to real user-contact lookup) but worth a note so it is not mistaken for a stable per-user number.

---

## Confirmed SOLID (verified, not just assumed)

- **Idempotency under concurrency (focus #1):** `runOnce` writes `processed_events` (PK) *first*, inside the tx, before the row batch. Two concurrent same-`event_id` deliveries serialize on the Postgres PK: the second INSERT blocks until the first commits, then gets 23505 → `DuplicateEventError` → idempotent no-op. Caught, never bubbles as a crash. Same-partition sequential processing + Kafka's offset-after-success means a single consumer never races itself. `markProcessed`+`createPendingBatch` share one commit boundary via AsyncLocalStorage `EntityManager` — no "marked processed but rows missing" divergence. Holds.
- **DLQ park never consumed (focus #4):** no `Worker` is bound to `notify-dlq` anywhere (workers only created for `CHANNEL_NAMES` in `notification.worker.ts:43-45`); `queue.pause()` at construction is explicit belt-and-suspenders. No limbo state. (Atomicity caveat = M1.)
- **Tenant scoping (focus #5):** `tenantId` comes only from the verified `x-tenant-id` envelope header (`event-envelope.ts:70` fails closed on missing/empty), never from the payload body. Rows stamped with `envelope.tenantId` (`dispatch…handler.ts:97`); worker lookups by server-generated UUID PK; body carries only `orderId`. No cross-tenant leak path found. Tenant index present.
- **Channel error handling (focus #6):** `MailpitEmailChannel.send` awaits `sendMail` and does not swallow — a transient SMTP failure throws → job fails → BullMQ retries → SENT written only after a genuine send. Stubs never throw (deterministic). No false-SENT path.
- **Consumer robustness (focus #9):** malformed JSON / missing header → `decodeMessage` throws → `undecodable` → `order.events.dlq` + commit past (no crash-loop). Handler exhaustion → DLQ + commit. Missing `orderId`/`userId` → warn+skip+commit. Unknown eventType → skip. All bounded.
- **SQL/migration (focus #7):** entity ↔ migration DDL consistent (uuid/varchar lengths/integer/text/timestamptz); status CHECK matches the enum; `uq_notifications_event_channel` and `processed_events` PK present; `synchronize:false` (migrations only). No divergence.
- **Secrets/config (focus #8):** no insecure prod-default secret (unlike the payment webhook-secret issue). Mailpit SMTP is unauthenticated dev-only by design; real SMTP creds deferred. No secret in logs.

---

## Unresolved questions
1. Is C1 (silent loss via enqueue-error + retry-dedupe, not just crash) an accepted risk for this learning slice, or should a PENDING-row reconciler land now? It is cheap given `jobId=notificationId` idempotency.
2. Intended `NOTIFY_*_ENABLED` prod posture? All three default `true`; disabling a channel after rows exist has no reconcile.
3. Real-provider timeline for H1/L3 — the double-send window and PII logging are acceptable only while email→Mailpit and sms/push are stubs.

---
**Status:** DONE
**Summary:** Architecture sound and pattern-faithful; idempotency/tenant/DLQ/consumer-robustness verified solid. One Critical silent-loss path (enqueue-after-dedupe-commit is deduped away on a plain enqueue error or restart — broader than the documented crash gap), plus an at-least-once duplicate-send window, a non-atomic DEAD/DLQ pair, and minor accuracy/PII nits.
**Ranked findings:**
- **Critical** C1 — enqueue-after-commit + handler-retry dedupe → silent (partial/total) notification loss with no DEAD/DLQ trace; reachable via Redis OOM/closing connection or restart, not just a crash.
- **High** H1 — duplicate real send on crash between send success and `markSent`; no `status==='SENT'` guard, no provider idempotency key.
- **Medium** M1 — DEAD row + `notify-dlq` park not atomic (Redis park failure → DEAD row, no parked job). M2 — copy templates silently degrade on unmapped type.
- **Low** L1 — DEAD row attempts under-reported by one (`markDead` omits `attempts`; retried 5, shows 4). L2 — uncaught `notifications` unique violation DLQs instead of no-op. L3 — recipient PII in logs/`error` column once real. L4 — stub phone collisions for non-numeric userIds.
