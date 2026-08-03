# Backlog D1 — BullMQ trace + metric propagation

Context: [plan.md](./plan.md) · [phase-08a-distributed-tracing.md](./phase-08a-distributed-tracing.md) · [phase-08b-metrics-logs-slo.md](./phase-08b-metrics-logs-slo.md)

## Overview
- **Priority**: portfolio-plus — first D-item. Closes the one caveat left in [phase-08-ops-observability.md](./phase-08-ops-observability.md): "trace context through Kafka **+ BullMQ**" — Kafka was done in 8a, BullMQ was deferred.
- **Status**: ✅ Verified live — branch `feat/bullmq-trace-propagation`. Awaiting review/merge.
  - **Live proof (real BullMQ + real Redis + a real W3C-propagator OTel provider)**: enqueued a job inside a `test-request` span via `injectJobTraceContext`, processed it through a real `Worker` via `runJobWithTrace`. Result: the `__traceparent` key **survived the Redis JSON round-trip** (the worker saw it in `job.data`), and the worker's `bullmq.process` span carried the **same trace id** as the enqueue span (`95b140df…`) — i.e. the process span parents to the originating trace across the real enqueue→Redis→worker boundary (not just the in-memory unit harness). Offline: shared-observability **44** + notification **25** + media **21** tests green; tsc ×4 + biome clean. Unit tests already assert span parenting (`InMemorySpanExporter` parent-span-id), metric recorded on success AND failure, never-throw on broken tracer/meter, and fn-error propagation (same error object, once).
- **Brief**: Kafka hops already propagate a W3C `traceparent` (8a) so a consumer span parents to the producer's trace. BullMQ jobs do NOT: `notification` (email/sms/push queues) and `media` (thumbnail queue) enqueue a job in one request/trace, and the worker processes it later in a **disconnected** trace — the job-processing work is invisible as a child of the originating request. Also no per-job metric exists. Propagate the trace context across the enqueue→process boundary and record a job duration/outcome metric, mirroring the existing `kafka-trace-propagation.ts` + `metrics.ts` patterns.

## Why the job DATA carries the context (not a header)
Kafka has a header channel; BullMQ does not. So the `traceparent` rides in the job data under a reserved key (`__traceparent`), added by the producer helper and read by the worker helper — never touching the domain payload types (added/read dynamically, ignored by the handlers). This is the standard BullMQ+OTel approach.

## Design (mirror `kafka-trace-propagation.ts` + the `record*` metric helpers)
- **New `libs/shared/observability/src/bullmq-trace-propagation.ts`** (pure, never-throws — tracing must never fail a job):
  - `injectJobTraceContext<T extends object>(data: T): T` — starts a short `bullmq.enqueue` PRODUCER span (so an enqueue with an active request span parents correctly, exactly like `injectTraceContext` does for Kafka) and returns `data` with `__traceparent` merged in (only when a context is active). Never throws → returns `data` unchanged on any failure.
  - `runJobWithTrace<T>(jobData, queueName, fn): Promise<T>` — reads `__traceparent` from `jobData`, starts a `bullmq.process` CONSUMER span parented to it (falls back to unparented/none on setup failure), runs `fn` inside that context exactly once (fn's own errors propagate — NOT caught as tracing failures), and records the job metric (duration + outcome=completed|failed) in a `finally`. Ends the span whether fn resolves or throws.
  - Export both from `index.ts`.
- **New metric in `metrics.ts`**: `recordBullmqJob(queue: string, outcome: 'completed' | 'failed', durationMs: number)` → a Histogram `bullmq_job_duration_ms` labelled `{queue, outcome}`. Bounded cardinality: queue ∈ {notify-email, notify-sms, notify-push, thumbnail}, outcome ∈ 2 values. Never throws (down Collector must not fail a job). `runJobWithTrace` calls it.
- **Producers** (add `injectJobTraceContext(payload)` to the `queue.add(...)` data):
  - `apps/notification/src/infrastructure/queue/bullmq-notification-queue.adapter.ts` `enqueue`.
  - `apps/media/src/infrastructure/queue/bullmq-thumbnail-queue.adapter.ts` (the thumbnail enqueue).
- **Workers** (wrap the processor fn in `runJobWithTrace(job.data, <queue>, () => handler(...))`):
  - `apps/notification/src/interface/queue/notification.worker.ts` — per-channel worker → `runJobWithTrace(job.data, CHANNEL_QUEUE_NAMES[channel], () => sendNotification.execute(job.data))`.
  - `apps/media/src/interface/queue/thumbnail.worker.ts` — `runJobWithTrace(job.data, THUMBNAIL_QUEUE_NAME, () => generateThumbnail.execute(job.data.mediaId))`.
- **DLQ**: check `bullmq-notification-dlq.adapter.ts` — if it reads/forwards `job.data`, the reserved `__traceparent` key rides harmlessly; strip it only if it would corrupt a DLQ payload assertion (verify).

## Related files
- NEW `libs/shared/observability/src/bullmq-trace-propagation.ts`; edit `metrics.ts` (+ `recordBullmqJob`), `index.ts` (exports).
- Edit both queue adapters (producers) + both workers (consumers).
- Tests: shared-observability unit (inject→extract round-trip parents the span; metric recorded once on success AND on failure; never-throws on a broken tracer/meter; fn errors propagate un-swallowed).

## Adversarial review — PASS (no Critical/High), one Low fixed
Report `reports/code-reviewer-260803-bullmq-trace-propagation-review-report.md`. All 6 correctness properties PASS: handler semantics unchanged (fn runs once, its own rejection re-throws untouched so BullMQ retry/backoff/DLQ still fire; only a tracing-SETUP failure falls back to untraced), never-throw on both helpers, metric recorded exactly once in `finally` on both paths, spans parented + per-call-resolved + ended everywhere, producer wiring intact. **L1 (Low) fixed**: the reserved `__traceparent` key leaked into the `notify-dlq` parked payload (cosmetic — overwritten on replay). Added a symmetric `stripJobTraceContext` and applied it in the worker's `failed` listener before the DLQ handler, so the DLQ parks the clean domain payload; the app handler stays telemetry-agnostic. Info notes I1/I2 (span.end not individually guarded — matches the accepted Kafka reference; the typed helper hides the key) accepted, no action.

## Todo
- [x] `bullmq-trace-propagation.ts`: `injectJobTraceContext` + `runJobWithTrace` (never-throw, fn-errors-propagate) + `stripJobTraceContext` + exports
- [x] `recordBullmqJob` histogram metric (bounded labels, never-throw)
- [x] wire producers (both queue adapters) + workers (both); strip key on the DLQ path
- [x] tests: round-trip parenting, metric on success+failure, never-throw, fn error propagation, strip
- [x] tsc/biome + affected tests green (shared-observability 46, notification 25, media 21); live real-Redis round-trip; plan updated before push

## Success criteria
- A job enqueued inside a request carries `__traceparent`; the worker processes it inside a CONSUMER span parented to the enqueue trace (verifiable: the process span shares the enqueue trace id).
- `bullmq_job_duration_ms{queue,outcome}` is emitted once per processed job (completed or failed).
- Tracing/metric failures never fail or block a job; a handler error still propagates (retry/backoff + the `failed` listener path unchanged).
- Existing notification + media tests stay green (workers skipped under NODE_ENV=test; helpers are no-ops without a registered provider).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Trace wrapper swallows/duplicates a handler error → wrong retry/DLQ behaviour | M×H | fn errors propagate untouched (mirror `runWithExtractedContext`); only tracing-SETUP failure falls back to running fn once; tests assert propagation |
| Reserved `__traceparent` key corrupts a payload assertion (DLQ / dedupe / jobId) | L×M | Key is additive + telemetry-only; jobId is set from `notificationId` (opts, not data); verify the DLQ adapter tolerates/strkps it |
| Metric label cardinality blows up | L×M | Labels are the fixed queue set + 2 outcomes — bounded; no job/media id labels |
| Enqueue span with no active context starts a fresh trace id | L×L | Same accepted behaviour as Kafka `injectTraceContext`; enqueue almost always runs inside a request span |

## Security considerations
- No new surface; `__traceparent` is a non-sensitive W3C id. Never-throw wrappers keep telemetry off the job's failure path.

## Next steps
Remaining D-items: Argo Rollouts, cosign/SLSA provenance, k6 load test. (Docs/README + CI badges deferred by the user.)
