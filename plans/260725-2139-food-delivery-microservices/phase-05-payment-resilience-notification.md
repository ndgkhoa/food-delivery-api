# Phase 5 — Payment workflow & resilience + Notification

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P1
- **Status**: 🔄 In progress — **5a** [payment durable Temporal workflow](./phase-05a-payment-temporal-workflow.md) merged (#18); **5b** [notification service](./phase-05b-notification-service.md) merged (#19); **5c** [gateway circuit breaker](./phase-05c-gateway-circuit-breaker.md) verified live + reviewed (fixed a body-stall hang), PR pending. NOTE: MailHog replaced by its maintained successor **Mailpit** (same SMTP :1025 + UI/API :8025).
- **Brief**: Replace the P3 payment-stub with a durable Temporal workflow (retry, webhook reconciliation, DLQ, idempotency, Outbox). Add resilience: circuit breaker at gateway. Build `notification` (Kafka consumer + BullMQ, retry, DLQ, email via Mailpit / SMS+push via stub adapters).

## Key insights
- Temporal makes payment durable: crash mid-charge resumes exactly where it left off. Retries + backoff + timers are declarative, not hand-rolled. This is the phase's headline learning.
- Provider result may arrive async via webhook → workflow waits on a Signal to reconcile. Idempotency key prevents double-charge.
- Notification adapters designed as an interface (`EmailChannel`/`SmsChannel`/`PushChannel`) — MailHog for email now, log/stub for SMS+push, so Twilio/FCM drop in later without touching consumers.
- DLQ = failed messages after N retries → parked topic/queue + alert, never silently dropped.

## Requirements
**Functional**: payment.charge → Temporal workflow (call provider activity, retry, on webhook signal reconcile, emit succeeded/failed via Outbox); notification consumes order/payment events → sends email (MailHog) + stub SMS/push; failed sends retry then DLQ.
**Non-functional**: idempotent charge; workflow durable across restart; circuit breaker opens on downstream failures at gateway; DLQ observable; retries bounded with backoff.

## Architecture
- `workflow` compose profile: Temporal server + its Postgres + Temporal UI.
- `payment`: Temporal worker hosting `ChargeWorkflow` + activities; consumes `payment.commands`; webhook HTTP endpoint signals workflow; emits replies via Outbox→Kafka.
- `notification`: Kafka consumer → enqueue BullMQ job per channel → channel adapter sends → retry policy → DLQ queue on exhaustion.
- Gateway: circuit breaker (e.g. opossum) around flaky downstreams; open→fail-fast + fallback.

## Related code files (to create)
- `apps/payment/workflows/charge-workflow.ts`, `apps/payment/activities/*`, webhook controller, Temporal worker bootstrap, Outbox emit
- `apps/notification/*` — Kafka consumer, BullMQ queues, `channels/{email,sms,push}.channel.ts` (interface + MailHog + stubs), DLQ handler
- `apps/gateway/*` — circuit-breaker wrapper for proxied calls
- `libs/shared/messaging` — DLQ helper (retry count + park); `libs/shared/contracts` webhook DTO
- `infra/*` — Temporal + Temporal UI (`workflow` profile), MailHog service

## Implementation steps
1. Add `workflow` profile (Temporal + Postgres + UI) and MailHog. Verify RAM with only needed profiles.
2. `payment`: Temporal worker; `ChargeWorkflow` (activity with retry policy, timers); idempotency key; webhook endpoint → `signalWorkflow`; emit succeeded/failed via Outbox.
3. Wire Saga (P3) to await payment reply as before — now backed by durable workflow.
4. `notification`: consumer → BullMQ per-channel jobs; email channel (MailHog SMTP), sms/push stub channels behind interface; retry + DLQ.
5. Gateway circuit breaker around downstream proxy calls; fallback responses.
6. E2E: successful charge confirms order + sends email; provider timeout → Temporal retries → webhook reconciles; permanent fail → payment.failed → Saga compensates + failure notification; kill payment worker mid-charge → resumes on restart; failing SMS stub → retries → DLQ.

## Todo
- [x] Temporal + UI under `workflow` profile · Mailpit under `notification` profile
- [x] ChargeWorkflow + activities + retry + idempotency (REJECT_DUPLICATE) + webhook signal + Outbox
- [x] Saga awaits durable payment reply (unchanged `payment.replies` contract)
- [x] notification consumer + BullMQ per-channel + channel adapter interface (Mailpit + sms/push stubs) + DLQ
- [x] gateway per-downstream circuit breaker (opossum) + 503/Retry-After fast-fail + per-service isolation (5c)
- [x] E2E: charge success + decline (5a), notification success + idempotent + DLQ (5b), breaker fast-fail + isolation + recovery (5c); worker-restart resume remains manual/UI

## Success criteria
- Charge succeeds → order CONFIRMED + email in MailHog. Duplicate charge command → single payment (idempotent).
- Kill payment worker mid-workflow → workflow resumes and completes on restart (durability proven).
- Provider permanent failure → Saga compensates, customer gets failure notification.
- Exhausted notification send → lands in DLQ with context, not lost. Circuit breaker opens under downstream outage, fails fast.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Temporal RAM/complexity | M×M | `workflow` profile only when needed; start from official TS samples |
| Double charge | L×H | Idempotency key + workflow-id = order id; provider idempotency key |
| Webhook race (arrives before workflow waits) | M×M | Signal buffering / query workflow state; store webhook then signal |
| DLQ ignored | M×M | Alert + dashboard; documented replay procedure |

## Security considerations
- Verify webhook signature (HMAC) + replay protection. Never trust unsigned callbacks.
- Payment secrets via env/secrets; PCI-sensitive data not stored (provider tokenizes).
- Notification content tenant-scoped; no leaking other tenants' order data. Rate-limit sends.

## Next steps
Unblocks P6 (analytics consumes payment.succeeded for revenue). Real Twilio/FCM can replace stubs later via the channel interface with no consumer changes.
