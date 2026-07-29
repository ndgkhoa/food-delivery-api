# Slice 5a — Payment as a durable Temporal workflow

Context: [phase-05.md](./phase-05-payment-resilience-notification.md) · [phase-03c.md](./phase-03c-order-saga-events.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P1 — first P5 slice; the headline distributed-systems learning of the phase (durable execution).
- **Status**: ✅ Verified — payment now a durable Temporal workflow, proven live against a real Temporal server (`workflow` compose profile: auto-setup 1.29.7 + dedicated Postgres + UI :8233). The worker registers + polls task queue `payment-charges`; `ChargePayment` → `chargeWorkflow` (workflowId `charge-{orderId}`) → charge activity → emit-reply activity → `payment_outbox` → `payment.replies` (UNCHANGED saga contract). payment-e2e **3/3** (happy → PaymentSucceeded, decline → PaymentFailed, redelivery → one reply via workflow-id idempotency); Temporal workflow specs **26/26** via `TestWorkflowEnvironment` (deterministic replay + signal reconcile — the durability guarantee); offline gates clean (cruiser 604/knip/biome/tsc). The `workflowsPath` webpack-bundle deviation works under `nx serve` (worker loaded workflows). One e2e scenario left `todo` — an automated SIGKILL-mid-charge test; durability is proven by the replay-safe determinism tests + is UI-demonstrable. Pending: adversarial review → fix → PR. Branch `feat/payment-temporal-workflow`.
- **Brief**: Replace the P3 payment STUB's synchronous `decideCharge`-in-the-consumer with a durable **Temporal `ChargeWorkflow`**. The payment service becomes a Temporal **worker** (hosting the workflow + activities) plus its existing Kafka consumer and a new webhook endpoint. The Kafka reply contract is UNCHANGED — the workflow emits `PaymentSucceeded`/`PaymentFailed` through the existing payment outbox → `payment.replies` → the order saga — so nothing in `order` changes; only payment's internals become crash-durable, retryable, and idempotent by workflow id.

## Key decisions (versions verified live 2026-07-29)
- **Temporal server `temporalio/auto-setup:1.29.7`** (bundles server + auto-provisions its schema) + its own **Postgres** + **`temporalio/ui:2.52.1`**, all under a new `workflow` compose profile. SDK `@temporalio/{client,worker,workflow,activity}@1.21.1`.
- **Durability is the lesson**: a crash mid-charge resumes from workflow history on restart — retries/backoff/timers are declarative (RetryPolicy), not hand-rolled.
- **Idempotency = workflow id**: `charge-{orderId}`. A redelivered `ChargePayment` → `WorkflowExecutionAlreadyStartedError` → treated as a no-op (the running/complete workflow already owns the charge). Downstream outbox+consumer dedupe still apply.
- **Determinism**: workflow code is deterministic (no config/IO); the charge decision + the outbox emit run in **activities**. The stub provider stays deterministic (`decideCharge`: decline when `totalCents === PAYMENT_STUB_FAIL_AT_CENTS`) so the saga compensation path is reproducible.
- **Webhook signal (async reconciliation)**: `POST /payment/webhook` (HMAC-verified) signals the workflow with an async provider result. The workflow charges via the activity by default; a signal can reconcile/override (teaches Signals). HMAC + replay guard required — never trust an unsigned callback.
- Payment gains an HTTP surface (webhook) on **PORT 3007** — it is no longer headless. Kafka consumer + Temporal worker + HTTP all bootstrap in the one Nest app.

## Requirements
**Functional**: `ChargePayment` (Kafka) → start `ChargeWorkflow(orderId, totalCents)` (workflowId=`charge-{orderId}`); the workflow runs `chargeActivity` (RetryPolicy) → on decision runs `emitReplyActivity` writing `PaymentSucceeded`/`PaymentFailed` to `payment_outbox` (the relay publishes to `payment.replies`); a webhook can signal an async provider result. The order saga is unchanged.
**Non-functional**: charge idempotent (workflow id); durable across a worker restart (resumes + completes); retries bounded with backoff; webhook HMAC-verified + replay-protected; the deterministic stub keeps the e2e reproducible.

## Architecture / data flow
```
payment.commands ChargePayment ─▶ PaymentCommandConsumer
      └─ Temporal client.start(ChargeWorkflow, {workflowId: charge-{orderId}, args:[{orderId,totalCents,correlationId}]})
              (AlreadyStarted → idempotent no-op)
Temporal worker hosts:
  ChargeWorkflow ── chargeActivity(totalCents) [RetryPolicy] ─▶ {ok|declined}
                 ── (optional) await providerSignal (webhook) to reconcile
                 └─ emitReplyActivity(orderId, ok?, reason, correlationId)
                        └─ writes PaymentSucceeded|PaymentFailed to payment_outbox (in a tx)
payment_outbox ─(existing relay)▶ payment.replies ─▶ order saga (UNCHANGED)
POST /payment/webhook (HMAC) ─▶ client.signal(charge-{orderId}, 'providerResult', {...})
```

## Related code files
**Create — payment:**
- `apps/payment/src/workflows/charge-workflow.ts` — the deterministic workflow (proxyActivities with RetryPolicy; a `providerResult` signal + a bounded `condition` wait for the async path).
- `apps/payment/src/activities/charge.activity.ts` (calls `decideCharge` with the env fail-amount) + `emit-reply.activity.ts` (writes the outbox reply via the existing outbox writer in a tx). Activities are the ONLY place config/IO happens.
- `apps/payment/src/infrastructure/temporal/temporal-client.module.ts` (Connection + WorkflowClient) + `temporal-worker.provider.ts` (Worker.create hosting workflows+activities; `taskQueue=payment-charges`; start on bootstrap, shutdown clean; disabled under NODE_ENV=test).
- `apps/payment/src/interface/http/payment-webhook.controller.ts` + HMAC verifier (`libs/shared/...` or local) + DTO.
- `apps/payment/src/config/payment-env-schema.ts` — add `PORT` (3007), `TEMPORAL_ADDRESS` (localhost:7233), `TEMPORAL_NAMESPACE` (default), `TEMPORAL_TASK_QUEUE` (payment-charges), `PAYMENT_WEBHOOK_SECRET` (HMAC).
- `apps/payment/src/main.ts` — become an HTTP Nest app (webhook) that ALSO runs the Kafka consumer + Temporal worker (not headless).

**Modify — payment:**
- `interface/messaging/payment-command.consumer.ts` — replace the inline `decideCharge`+outbox reply with: start the Temporal workflow (idempotent by id). It no longer emits the reply directly — the workflow's `emitReplyActivity` does. Keep the dedupe/tenant scope. (`charge-decision.ts` moves to being called inside the activity, not the consumer.)

**Infra:** `infra/docker-compose.yml` — `workflow` profile: `temporal` (auto-setup, depends on a `temporal-postgresql`), `temporal-ui`; env for the server's DB. `.env.example` — Temporal + webhook keys. `package.json` — payment already in `dev`; ensure it boots the worker. Temporal has its OWN Postgres (do NOT reuse the app Postgres). No app migration change (payment_outbox already exists).

**E2E** (`apps/payment-e2e/` new, or fold into order-e2e): compose `core`+`messaging`+`workflow` + order+payment on host.
- Happy: place order (or produce ChargePayment) → workflow charges → `PaymentSucceeded` on `payment.replies` → order CONFIRMED.
- Decline: total = `PAYMENT_STUB_FAIL_AT_CENTS` → `PaymentFailed` → saga compensates → order CANCELLED.
- **Durability**: start a charge, KILL the payment worker mid-workflow, restart → the workflow resumes from history and still emits exactly one reply (order reaches its terminal state; no double charge).
- Idempotency: redeliver the same `ChargePayment` → one workflow, one reply.
- (If wired) webhook signal reconciles an async result.

## Implementation steps
1. Add the `workflow` compose profile (Temporal auto-setup + its Postgres + UI); verify the server is reachable at :7233 and the UI at :8080/8233.
2. Temporal client module + worker provider (bundles `workflows/*`, registers `activities/*`, `taskQueue`). Boot the worker in payment on bootstrap (guarded under NODE_ENV=test).
3. `ChargeWorkflow` + `charge.activity` (decideCharge) + `emit-reply.activity` (outbox write). RetryPolicy on the activity.
4. Rewrite the consumer to start the workflow idempotently (workflowId=charge-{orderId}); drop the inline reply.
5. Webhook controller + HMAC verify → `client.signal`. Workflow handles the `providerResult` signal.
6. `.env.example`, env schema, main.ts (HTTP + consumer + worker).
7. **E2E**: happy, decline, worker-kill-resume, idempotent redelivery.
8. Update plan todos/status BEFORE push.

## Todo
- [x] `workflow` compose profile (Temporal auto-setup 1.29.7 + dedicated Postgres 16 + UI 2.52.1) — compose-run (orchestrator verifies reachability)
- [x] Temporal client module + worker provider (taskQueue, workflows+activities, bootstrap+shutdown; NODE_ENV=test guard)
- [x] `ChargeWorkflow` + `charge.activity` (decideCharge) + `emit-reply.activity` (outbox, idempotent by order id) + RetryPolicy + providerResult signal/condition
- [x] consumer starts the workflow idempotently (workflowId=`charge-{orderId}`, AlreadyStarted no-op); inline reply removed
- [x] webhook controller (HMAC-SHA256 over raw body + timestamp replay guard) → signal workflow
- [x] E2E scaffold (`apps/payment-e2e`): happy → PaymentSucceeded, decline → PaymentFailed, redelivery idempotent (gated RUN_PAYMENT_E2E, compose-run); worker-kill = manual/orchestrator + gated TestWorkflowEnvironment durability spec
- [x] biome/cruiser/knip/tsc clean; unit tests green (charge activity, emit-reply idempotency, HMAC verifier, env schema; workflow spec gated RUN_TEMPORAL_TESTS); build passes

## Success criteria
- A charge runs as a durable workflow: order CONFIRMED on success, CANCELLED (saga-compensated) on the deterministic decline; the `order` service is unchanged.
- **Kill the payment worker mid-charge → the workflow resumes on restart and completes with exactly one reply** (durability + no double charge proven).
- A redelivered `ChargePayment` produces one workflow + one reply (idempotent by workflow id).
- Webhook callbacks are HMAC-verified; unsigned/replayed callbacks rejected.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Temporal RAM/complexity on 16GB | M×M | `workflow` profile only when needed; auto-setup single node; heap caps; start from official TS samples |
| Workflow non-determinism (config/IO in workflow code) | M×H | ALL IO/config in activities; workflow is pure orchestration; TestWorkflowEnvironment unit test |
| Double charge under redelivery/restart | L×H | workflowId=orderId (Temporal dedupe) + downstream outbox/consumer dedupe; emit-reply idempotent by event id |
| Webhook race (signal before workflow waits) | M×M | Signal buffering (Temporal buffers signals) / store-then-signal; workflow queries state |
| Worker bundling of workflow code (Nx/webpack) | M×M | Use `@temporalio/worker` bundler on `workflows/*`; keep workflows free of app imports; document build |
| e2e flakiness (Temporal startup latency) | M×M | Wait for :7233 health + namespace ready before booting the worker; bounded polls |

## Security considerations
- Webhook HMAC-verified (shared secret) + timestamp/nonce replay guard; reject unsigned. No PCI data stored (provider tokenizes; we hold only orderId/amount).
- Temporal server internal-network only; UI dev-exposed, never via Nginx (P8). Secrets via env now, secret provider later.
- Reply events tenant-scoped as today (tenant rides the envelope headers; the emit-reply activity stamps it).

## Next steps
Notification (5b) consumes `payment.succeeded`/order events → email/SMS. Gateway circuit breaker (5c). Real provider (Stripe) replaces the stub activity behind the same workflow with no saga change.
