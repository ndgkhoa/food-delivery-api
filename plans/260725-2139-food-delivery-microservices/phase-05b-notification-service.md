# Slice 5b — Notification service (Kafka → BullMQ per-channel → Mailpit + stubs → DLQ)

Context: [phase-05.md](./phase-05-payment-resilience-notification.md) · [phase-04c.md](./phase-04c-media-minio-uploads.md) · [phase-04b.md](./phase-04b-delivery-realtime.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P1 — second P5 slice (after 5a payment Temporal, #18). Independent of 5c gateway circuit breaker.
- **Status**: ✅ Verified live (adversarial review in progress) — headless notification service built + proven against a real stack (`core`+`messaging`+`notification`/Mailpit compose). Consumer registers on `order.events` (3 partitions); `OrderConfirmed`/`OrderCancelled` → recipient stub → `notifications` rows PENDING per channel → BullMQ `notify-<channel>` → adapters send → SENT. Live evidence: **Mailpit captured 3 emails** ("Your order is confirmed" ×2 + "Your order was cancelled" ×1 to `${userId}@example.test`); `notifications` = 9 rows (3 events × 3 channels) all **SENT**; **idempotent redelivery** — 3 distinct event_ids × exactly 3 rows (no dup), 3 `processed_events`, unique `(event_id,channel)`; **DLQ** — Mailpit down → email row **DEAD** (err `ECONNREFUSED …:1025`) + exactly **1 parked job** in `bull:notify-dlq:paused` (never consumed). Offline gates clean (tsc/biome/depcruise/knip + **25 unit** tests). notification-e2e **3/3** happy+idempotent (gated `RUN_NOTIFICATION_E2E`), **1/1** DLQ (gated `RUN_NOTIFICATION_DLQ_E2E`). Branch `feat/notification-service`.
- **Adversarial review + fixes applied** (report `reports/code-reviewer-260729-2036-slice-5b-notification-red-team-review-report.md`; idempotency-under-concurrency, tenant scoping, DLQ-never-consumed, consumer crash-resistance verified airtight):
  - **C1 (Critical)** — silent notification loss when a BullMQ enqueue failed AFTER the dedupe tx committed: the shared consumer's own retry re-ran the handler, hit the committed `processed_events`, and **skipped the enqueue loop** → rows stranded PENDING, no job, no DEAD/DLQ. Reachable on a plain Redis blip / rolling deploy, not just a crash. **Fixed**: enqueue is now driven from the persisted PENDING rows and runs on EVERY delivery (idempotent by `jobId=notificationId`); a throw propagates so the consumer retries/dead-letters — a stranded PENDING is re-driven, never silently skipped (regression test added).
  - **H1 (High)** — a job re-run after a crash between send-success and `markSent` re-sent. **Fixed**: worker no-ops when the row is already `SENT` (residual send↔markSent window documented, needs a provider idempotency key at the real-provider swap).
  - **M1** — DEAD row + DLQ park not atomic (`markDead` then `park`; a park throw left a DEAD row with no job). **Fixed**: park FIRST, then `markDead`.
  - **M2** — copy map silently degraded to generic content for an unmapped type. **Fixed**: `subjectFor`/`bodyFor` throw (fail loud → job fails → DLQ, never a wrong email).
  - **L1** — `markDead` dropped the `attempts` count (DEAD row showed 4 vs the 5 attempts actually made). **Fixed**: `markDead` writes `attemptsMade` (live-confirmed attempts=5).
  - Deferred (documented, real-provider swap): **L3** recipient PII in stub logs / persisted error, **L4** recipient-stub phone shape for non-numeric userIds. All verified live after fixes (happy+idempotent 3/3, DLQ 1/1, DEAD attempts=5, park-before-dead).
- **Brief**: New `apps/notification` service: a **Kafka consumer** on `order.events` (`OrderConfirmed`/`OrderCancelled`) that fans each event out to **BullMQ per-channel jobs**; a worker per channel sends through a **`NotificationChannel` interface** — **email via Mailpit SMTP (nodemailer)** now, **SMS + push as log/stub adapters** — with bounded **retry + backoff**, and on exhaustion the job is **parked in a dead-letter queue** (never silently dropped). A `notifications` table records every send for observability; the consumer is **idempotent** by event id so a redelivered order event never double-sends.

## Key decisions (versions verified live 2026-07-29)
- **Mailpit** (`axllent/mailpit`, SMTP :1025 + web UI/API :8025) as the dev SMTP catcher under a new `notification` compose profile — the maintained drop-in successor to the archived MailHog the phase-05 doc named (repo "latest stable" principle; Mailpit's REST API lets the e2e assert the captured message). **nodemailer 9.0.3** (+ `@types/nodemailer` 8.0.1) for SMTP.
- **BullMQ 5.81.2** on the existing `core` Redis (already a dep, same as media 4c) — one queue per channel (`notify-email`, `notify-sms`, `notify-push`). Job payload = `{ notificationId, channel, type, recipient, tenantId, data }`. `attempts` + exponential `backoff`; on final failure a `failed` handler moves the payload to a parked **`notify-dlq`** queue (paused/never consumed) so exhausted sends stay observable.
- **Channel interface** `NotificationChannel { send(msg): Promise<void> }` with three adapters: `MailpitEmailChannel` (nodemailer SMTP), `LogSmsChannel`, `LogPushChannel` (stubs). Twilio/FCM drop in later behind the same port with no consumer/worker change.
- **Trigger = `order.events`** (`OrderConfirmed` → confirmation, `OrderCancelled` → cancellation), the customer-facing source `delivery` already consumes (`apps/delivery/src/interface/messaging/order-events.consumer.ts`) — reuse that shape. Payment success/failure is already reflected in the order state transition, so we do NOT couple to the `payment.replies` saga channel (YAGNI). Documented; add a payment-event trigger only if a notification type needs it.
- **Recipient**: order events carry `userId`, not an email. A stub `RecipientResolver` maps `userId → { email: `${userId}@example.test`, phone, pushToken }` for the learning slice — real contact lookup (user service) deferred. Note the seam clearly.
- **Idempotency + persistence**: reuse `IdempotentConsumer` (dedupe by event id in the effect tx, like payment/inventory). `notifications` table: `id, tenant_id, event_id, channel, recipient, type, status(PENDING|SENT|FAILED|DEAD), attempts, error, created_at, updated_at` — one row per (event, channel), status advanced by the worker.
- **Headless** consumer + worker (no public HTTP, like pre-5a payment) — no gateway route. Its own `notification` Postgres DB.

## Requirements
**Functional**: consume `order.events` → for each `OrderConfirmed`/`OrderCancelled`, resolve recipient → create a `notifications` row (PENDING) per enabled channel → enqueue a BullMQ job per channel; the per-channel worker sends via its adapter → `SENT`; a failed send retries (BullMQ attempts+backoff) then, on exhaustion, → `DEAD` + payload parked in `notify-dlq`. Idempotent by event id (redelivered event = no duplicate rows/sends).
**Non-functional**: bounded retries with backoff; DLQ observable (parked queue + `DEAD` rows, never lost); tenant-scoped (envelope tenant stamped onto rows + never leaks cross-tenant order data); email actually lands in Mailpit; sms/push stubs log deterministically; consumer survives Mailpit being down (job retries, not consumer crash).

## Architecture / data flow
```
order.events (OrderConfirmed|OrderCancelled) ─▶ NotificationConsumer (idempotent by event id)
     └─ RecipientResolver(userId) → {email,phone,pushToken}
     └─ per enabled channel: notifications row PENDING ─▶ BullMQ.add(notify-<channel>, {notificationId,...})
BullMQ workers (per channel):
  notify-email ─▶ MailpitEmailChannel (nodemailer SMTP :1025) ─▶ row SENT
  notify-sms   ─▶ LogSmsChannel (stub)                        ─▶ row SENT
  notify-push  ─▶ LogPushChannel (stub)                       ─▶ row SENT
     └─ on send failure: BullMQ retry (attempts+backoff)
          └─ exhausted → row DEAD + enqueue notify-dlq (parked, never consumed)  ← observable, not lost
Mailpit UI/API :8025  (e2e asserts the captured email)
```

## Related code files (to create)
- `apps/notification/` — Nx HTTP-less app (bootstrap consumer + workers): project.json (`scope:notification, type:app`), tsconfig*, jest, webpack, main.ts (pino, shutdown hooks; NODE_ENV=test guards the worker/consumer like payment).
- `config/notification-env-schema.ts` — DB_* (own `notification` DB), KAFKA_BROKERS/CLIENT_ID, REDIS_URL (BullMQ), SMTP_HOST/SMTP_PORT (Mailpit), MAIL_FROM, NOTIFY_MAX_ATTEMPTS (default 5), NOTIFY_BACKOFF_MS, channel enable flags (SMS/PUSH stubs on).
- `domain/notification/*` — `Notification` model + status enum, `notification.repository.ts` port, `notification-channel.port.ts` (`send`), `recipient-resolver.port.ts`, message/type value objects.
- `application/*` — `dispatch-order-event.handler.ts` (event → rows + enqueue), `send-notification.handler.ts` (worker use-case), `RecipientResolver` stub.
- `infrastructure/messaging/*` — `order-events.consumer.ts` (idempotent, mirrors delivery's), envelope parse.
- `infrastructure/queue/*` — BullMQ queues (per channel) + workers + `notify-dlq` park + worker bootstrap provider (mirrors media 4c `thumbnail.worker.ts`).
- `infrastructure/channels/*` — `mailpit-email.channel.ts` (nodemailer), `log-sms.channel.ts`, `log-push.channel.ts`.
- `infrastructure/persistence/*` — TypeORM entity + repo + migration `*-create-notifications.ts` (+ reuse the shared `processed_events` pattern for dedupe; add its migration if notification has its own DB).
- `infra/docker-compose.yml` — `mailpit` service under a `notification` profile + `infra/postgres/init/01-create-service-databases.sh` (+`notification` DB). `.env.example` — notification keys. `package.json` — `notification` in `dev` + `db:migrate`. `.dependency-cruiser.js` tags already cover `scope:notification` (verify).
- `apps/notification-e2e/` — compose `core`+`messaging`+`notification`: produce an `OrderConfirmed` on `order.events` → assert (a) a Mailpit message via its REST API, (b) a `SENT` row per channel, (c) redelivery = no duplicate; force a send failure (bad SMTP host) → assert retries then a `DEAD` row + `notify-dlq` parked job.

## Implementation steps
1. Scaffold `apps/notification` (headless: consumer + workers) + its Postgres DB; mirror payment's non-HTTP bootstrap + media's BullMQ worker wiring.
2. Migration `notifications` (+ `processed_events` if own DB); TypeORM entity/repo.
3. `NotificationChannel` port + 3 adapters (Mailpit nodemailer, sms/push log stubs) + `RecipientResolver` stub.
4. BullMQ per-channel queues + workers + `notify-dlq` park-on-exhaustion; env-driven attempts/backoff.
5. `order-events.consumer.ts` (idempotent by event id) → dispatch handler → rows PENDING + enqueue per channel.
6. compose Mailpit (`notification` profile) + notification DB init + `.env.example` + `dev`/`db:migrate`.
7. **E2E**: OrderConfirmed → Mailpit email + SENT rows + idempotent redelivery; forced failure → retries → DEAD + DLQ parked.
8. biome/cruiser/knip/tsc + unit tests; update plan todos/status BEFORE push.

## Todo
- [x] `apps/notification` scaffolded (headless consumer+workers) + own Postgres + env schema
- [x] `notifications` (+processed_events) migration + repo
- [x] `NotificationChannel` port + Mailpit email (nodemailer) + sms/push log stubs + RecipientResolver stub
- [x] BullMQ per-channel queues + workers + `notify-dlq` park-on-exhaustion (attempts+backoff)
- [x] `order.events` idempotent consumer → dispatch → rows PENDING + enqueue per channel
- [x] compose Mailpit (`notification` profile) + DB init + gateway N/A + dev/db:migrate + .env.example
- [x] E2E: OrderConfirmed → Mailpit email + SENT rows + idempotent; forced-fail → retries → DEAD + DLQ
- [x] biome/cruiser/knip/tsc clean; unit tests; plan updated before push

## Success criteria
- An `OrderConfirmed` event produces a real email captured in Mailpit + a `SENT` row per enabled channel; sms/push stubs log deterministically.
- A redelivered order event creates no duplicate rows and sends nothing twice (idempotent by event id).
- A send that fails past `NOTIFY_MAX_ATTEMPTS` lands as a `DEAD` row + a parked `notify-dlq` job with context — never silently lost; a Mailpit outage retries the job without crashing the consumer.
- Notifications tenant-scoped; no cross-tenant order data leaks.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Double-send on redelivery | M×H | `IdempotentConsumer` dedupe by event id in the row-create tx; jobId = `${notificationId}` for BullMQ dedup |
| DLQ ignored / silent loss | M×M | Park in `notify-dlq` (never auto-consumed) + `DEAD` row + error captured; documented replay |
| Mailpit down blocks consumer | M×M | Send happens in the BullMQ worker (retried), NOT in the Kafka handler; consumer only enqueues |
| Recipient stub mistaken for real | L×M | `RecipientResolver` port + clear stub note; real user-contact lookup deferred |
| sms/push stub mistaken for real send | L×L | Log adapters clearly labelled; behind the same port for later Twilio/FCM |
| notification RAM (extra service) | L×L | Headless, small; `notification` profile only when needed |

## Security considerations
- Tenant rides the envelope headers; every `notifications` row + query is tenant-scoped. No other tenant's order data in a message body.
- SMTP creds (real provider later) via env/secret provider (P8); Mailpit dev-only, internal network, never via Nginx.
- Rate-limit sends per recipient (guard against a redelivery storm) — bounded by idempotency + BullMQ dedup now; explicit rate-limit deferred with real providers.
- No PII beyond order summary in the message; stub recipient is synthetic.

## Next steps
5c gateway circuit breaker (opossum) completes P5. Real Twilio/FCM + user-contact lookup replace the stubs behind the unchanged channel/recipient ports. Payment/delivery events can add notification types with no consumer redesign.
