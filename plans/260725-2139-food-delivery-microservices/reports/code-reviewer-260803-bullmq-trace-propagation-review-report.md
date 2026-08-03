# Code Review — BullMQ trace + metric propagation (`feat/bullmq-trace-propagation`)

Scope: uncommitted change, reviewed vs `develop`. New helper + metrics + 2 producers + 2 workers + spec.
Bar: instrumentation MUST be invisible to job success/failure/retry/DLQ semantics.

## Verdict: PASS — no Critical/High findings.

The change is a faithful port of `kafka-trace-propagation.ts`. Handler semantics are preserved on every
path, the helpers are never-throw, the metric is bounded and recorded exactly once, and spans parent
correctly. All 44 tests in `shared-observability` pass (`nx test shared-observability`), which also
type-checks via ts-jest.

## Property-by-property result

1. **Handler semantics unchanged — PASS.** `runJobWithTrace` (`bullmq-trace-propagation.ts:74-103`)
   runs `fn` exactly once on both paths. The setup `try/catch` (`:82-98`) wraps ONLY
   `propagation.extract` + `startSpan` + `setSpan` — `fn` is never inside it, so a tracing-setup failure
   is the *only* thing that falls back to running `fn` untraced (`:97`), and `fn`'s own rejection can
   never be caught there. Success path (`:102`) runs `fn` once inside the span; its error re-throws
   untouched through `timeAndRecord`'s `catch` (`:111-113`). BullMQ therefore still sees the original
   rejection → drives retry/backoff → `failed` listener reads `attemptsMade` → DLQ. Verified by the
   "propagates a fn rejection exactly once — never re-runs fn" test. No path can swallow a handler error,
   double-run the handler, or mark a failed job completed.

2. **Never-throw — PASS.** `injectJobTraceContext` wraps its whole body in try/catch and returns `data`
   unchanged on failure (`:55-60`). `recordBullmqJob` (`metrics.ts:160-170`) is try/catch guarded.
   `meter()`/tracer resolved per-call. Verified by the "broken tracer"/"broken meter" tests — enqueue and
   job both still succeed.

3. **Reserved `__traceparent` key — PASS (one Low note).** `jobId` comes from `opts`
   (`bullmq-notification-queue.adapter.ts:42` uses `payload.notificationId`;
   `bullmq-thumbnail-queue.adapter.ts:36` uses `mediaId`) — NOT from `job.data` — so the added key does
   not perturb dedupe. Handlers read named fields only (`send-notification.handler.ts:27-45`,
   `generate-thumbnail.handler.ts` reads `job.data.mediaId`) — an extra field is ignored. The key is a
   plain string → survives the Redis JSON round-trip and rides retries intact (desirable: a retry
   re-parents to the original enqueue trace). `injectJobTraceContext` returns a NEW object (`{...data}`),
   never mutates the caller's payload. See L1 for the only leak.

4. **Metric cardinality + correctness — PASS.** `bullmq_job_duration_ms{queue,outcome}`: `queue` is a
   fixed string (`CHANNEL_QUEUE_NAMES[channel]` / `THUMBNAIL_QUEUE_NAME`), `outcome ∈ {completed,failed}`
   only (`metrics.ts:11`). Duration via `process.hrtime.bigint()` (monotonic, immune to wall-clock
   skew) / 1e6 → ms (`:115`). Recorded exactly once per call in `timeAndRecord`'s `finally` (`:114-118`)
   on BOTH the traced and untraced-fallback paths; `runJobWithTrace` is the sole call site (grep-confirmed).

5. **Span correctness — PASS.** PRODUCER `bullmq.enqueue` span on inject (`:38-50`), CONSUMER
   `bullmq.process` span parented to the extracted context (`:86-89`). Tracer resolved fresh per call in
   both helpers (never module-cached — matches the reference rationale). Spans end in all paths
   (inject: `finally span.end()`; consumer: `timeAndRecord` `finally`). Parent linkage verified by the
   "parents the process span to the injected traceparent" test.

6. **Producer wiring — PASS.** Both adapters wrap the payload (`...queue.adapter.ts:41` / `:35`); all
   `opts` (attempts/backoff/jobId/removeOnComplete/removeOnFail) are unchanged. Both are the only enqueue
   paths (`dispatch-order-event.handler.ts:122` → `queue.enqueue`; `complete-upload.handler.ts:71` →
   `queue.enqueue`). The DLQ `.add('parked', …)` correctly does NOT inject (never-consumed queue).

## Findings

### Low
- **L1 — stale `__traceparent` leaks into the `notify-dlq` parked payload.**
  `handle-send-failure.handler.ts:50` parks `{ ...payload, error }`, where `payload` is `job.data`, which
  now carries `__traceparent`. So an exhausted send's parked JSON contains a stale traceparent from the
  failed attempt. Impact: purely cosmetic for an inspection/replay queue — a replay through `enqueue()`
  overwrites it with a fresh one (`injectJobTraceContext` spreads `...data` then sets the key). Only a
  raw re-add that bypasses `enqueue()` would forward the stale value, harmlessly linking the replay to the
  old trace. No semantic effect. Optional fix if you want the parked payload clean: strip the reserved key
  before parking, e.g. destructure it off in the `failed` listener before calling
  `handleSendFailure.execute`, or have `park` omit `BULLMQ_TRACEPARENT_KEY`. Recommend: leave as-is (YAGNI)
  or add a one-line strip — not blocking.

### Informational
- **I1 — `span.end()` in the `finally` blocks is not individually try/catch-guarded**
  (`bullmq-trace-propagation.ts:117`; also inject at `:48`). `recordBullmqJob` is guarded but `span.end()`
  is not, so a hypothetical throwing SpanProcessor.onEnd would propagate out of the `finally` and could
  mask `fn`'s result/error. In practice OTel `span.end()` is non-throwing (BatchSpanProcessor enqueues;
  OTLP export is async, not in `end()`), and this is IDENTICAL to the accepted `kafka-trace-propagation.ts`
  reference (`:132-134`). Consistent-with-reference → no action. Flag only for awareness.
- **I2 — `injectJobTraceContext<T>(data: T): T` return type hides the added key** from the type system
  (the returned object really has an extra property). This is intentional (keeps domain payload types
  clean) and is precisely WHY L1's leak is invisible at compile time. No change recommended; noting the
  linkage.

## Positive observations
- Setup-vs-handler error separation is done correctly and is explicitly commented (`:90-93`), the exact
  subtlety most likely to be gotten wrong.
- Metric recorded in `finally` on both paths → no double-count, no missed-count; single call site.
- `process.hrtime.bigint()` (monotonic) rather than `Date.now()` for duration.
- Payload is copied, not mutated — no side effect on the caller's object.
- Test suite is thorough: covers rejection-runs-once, both metric outcomes, parent linkage, no-traceparent
  fallback, broken-tracer fallback, broken-meter never-throw, and "no key added when no traceparent".

## Unresolved questions
- None. L1 is a judgment call (cosmetic DLQ payload cleanliness) for the author, not a correctness gate.
