# Red-Team Review — Slice 8a Distributed Tracing (`feat/otel-tracing`)

Reviewer: code-reviewer (adversarial pass) · Date: 2026-07-31
Scope: OTel base wiring + outbox traceparent persistence + Temporal traceparent propagation. All changes uncommitted on `feat/otel-tracing`.

## Verdict

Design is sound and the never-throw discipline is applied almost everywhere correctly. Live evidence (single 113-span trace, outbox `trace_parent` continuity, clean migrations) holds up. **One real defect** in the two `run*` wrappers: their `catch` swallows *business* errors (not just tracing errors) and **re-executes the wrapped work**, violating the exact contract the slice set out to guarantee. Everything else is Low/informational.

---

## HIGH — `runWithExtractedContext` / `runWithTraceParent` swallow business errors and double-execute the wrapped work

**Files:**
- `libs/shared/observability/src/kafka-trace-propagation.ts:105-130` (`runWithExtractedContext`)
- `libs/shared/observability/src/kafka-trace-propagation.ts:144-160` (`runWithTraceParent`)

**The flaw.** Both wrappers put the `await fn()` *inside* the `try`, and the `catch` ends with `return fn()`. When the wrapped work (the real business/IO code) throws, the `await` rejects, control lands in the `catch`, the error is logged as a **tracing** failure, and `fn()` is **run a second time**. The `catch` cannot tell a tracing-setup failure (fn never ran) from an fn failure (fn already ran + threw).

`runWithTraceParent`:
```ts
try {
  const ctx = propagation.extract(context.active(), { traceparent: traceParent });
  return await context.with(ctx, fn);   // if fn rejects, we land in catch
} catch (error) {
  logger.warn(`failed to activate captured trace context...`);
  return fn();                          // <-- RE-RUNS the business work
}
```
`runWithExtractedContext` has the identical shape (fn runs inside `startActiveSpan`, inside the `try`; catch does `return fn()`).

**Empirically confirmed** (ran against the repo's own `@opentelemetry/api`): a wrapped fn that throws once is invoked **twice**; the first error is logged as "failed to activate captured trace context" and the second propagates. `context.with` / `startActiveSpan` do **not** throw for tracing reasons on valid input, so in practice the only error the `catch` ever sees is fn's own business error.

**Concrete failure scenarios:**

1. **Kafka consumer (`kafka-consumer.ts:180`).** `fn` = `consumeOneMessage`, which throws when `commit()` (`consumer.commitOffsets`) throws on a broker hiccup. Pre-slice, that throw propagated once out of `eachMessage` → normal redelivery. Post-slice, `runWithExtractedContext` catches it, logs it as a *trace-extraction* failure, and re-runs the **entire** decode→retry→handler→commit pipeline. So a single commit blip now silently re-invokes the handler and re-commits. Bounded by handler idempotency, but it is a behavior regression and the error is mislabelled.

2. **Temporal emit-reply activity (`emit-reply.activity.ts:43`).** `fn` = `tenantContext.run → transaction → IdempotentConsumer.runOnce → outbox.append`. A transient DB fault (deadlock, dropped connection) makes `context.with` reject; the catch logs "failed to activate captured trace context" (misleading — it was a DB error) and re-runs the whole transaction. Within one activity attempt the first tx rolled back (no processed-events marker committed), so the second run proceeds fresh; if it succeeds the activity reports success, masking the fault from Temporal's retry/metrics.

**Why it matters (severity = High, not Critical):** no message loss or data corruption, because handlers and the emit-reply write are idempotent (dedupe by event id / order id). But it (a) **violates the stated contract** — "the catch must only swallow tracing errors, not business errors" — which this slice explicitly set out to guarantee; (b) **mislabels business errors as tracing failures**, which will send on-call down the wrong path during an incident (a DB outage logged as "trace context" noise); (c) is a **behavior regression** on the consumer path vs pre-slice; (d) is **untested** — the new emit-reply spec only covers the happy path.

**Fix.** Keep only the tracing *setup* inside the `try`; run `fn` outside any catch so its errors propagate exactly once. E.g.:

```ts
export async function runWithTraceParent<T>(traceParent, fn): Promise<T> {
  if (!traceParent) return fn();
  let ctx: Context;
  try {
    ctx = propagation.extract(context.active(), { traceparent: traceParent });
  } catch (error) {
    logger.warn(`failed to activate captured trace context, running without it: ${reasonOf(error)}`);
    return fn();                       // setup failed, fn never ran
  }
  return context.with(ctx, fn);        // fn's errors propagate untouched
}
```
For `runWithExtractedContext`, build the parented context + span in the `try`, then run fn in a separate un-caught step, ending the span in a `finally`:
```ts
let span, ctxWithSpan;
try {
  const extracted = propagation.extract(context.active(), headers ?? {}, rawHeaderGetter);
  span = trace.getTracer(TRACER_NAME).startSpan(spanName, { kind: SpanKind.CONSUMER }, extracted);
  ctxWithSpan = trace.setSpan(extracted, span);
} catch (error) {
  logger.warn(`failed to extract trace context, processing without it: ${reasonOf(error)}`);
  return fn();
}
try { return await context.with(ctxWithSpan, fn); }
finally { span.end(); }
```
Add a regression test: wrap a fn that throws once, assert it is invoked exactly once and the error propagates.

---

## LOW / Informational (no action required, noted for completeness)

- **`injectTraceContext` / `captureActiveTraceContext` are correct** (`kafka-trace-propagation.ts:47,82`): neither wraps business logic — the span callback only does `propagation.inject`, so the double-execution flaw does **not** apply here. Their `catch` genuinely only swallows tracing errors. Good.

- **Producer guard + fetchUnpublished are correct** (`kafka-producer.ts:41`, `typeorm-*-outbox.adapter.ts` `fetchUnpublished`): `if (!message.headers.traceparent)` + `if (row.trace_parent)` handle null cleanly. `propagation.inject` never emits an empty/whitespace traceparent, so there is no falsy-but-present edge; a malformed persisted value would at worst yield a disconnected root span, never a throw. No double-span: a persisted traceparent suppresses producer injection.

- **Idempotency/retry interaction is safe:** `input.traceParent` is fixed at `startCharge` (`temporal-workflow-gateway.adapter.ts:49`) and threaded as a workflow arg, so every activity retry re-activates the *same* traceparent — stable trace id across retries. A redelivered `ChargePayment` hits `REJECT_DUPLICATE`, so a second (different) traceparent never spawns a new run.

- **Temporal sandbox determinism holds:** `charge-workflow.types.ts` is import-free; `charge-workflow.ts` forwards `traceParent` as a plain string, no non-deterministic import leaks into the bundle. The decision to skip `@temporalio/interceptors-opentelemetry` (OTel 1.x hard-dep vs repo's 2.10.0) is sound — mixing two OTel cores risks silent context loss; string-passthrough matches how correlationId/tenantId already flow. Trade-off accepted.

- **Migrations are safe:** 4× additive `ADD COLUMN ... varchar(64) NULL` — Postgres metadata-only, no table rewrite/rewrite-lock even on a large `order_outbox`; reversible `down`; registered in each test DB; no plan/finding tokens in filenames or SQL. `order`'s partitioned table is `orders`, not `order_outbox` (plain table) — ALTER is safe.

- **PII/secrets:** `traceparent` is trace/span ids only — no PII. Outbox forwards only the W3C header. Auto-instrumentation HTTP spans may capture `http.url` (query strings) — standard OTel behavior, dev-only collector, off by default; acceptable for this slice.

- **Collector/Jaeger exposure:** `observability` compose profile is off by default and not referenced by Nginx/gateway — not reachable in prod. Host port bindings default to `0.0.0.0` (LAN-reachable on a dev box), but that is dev-only and deliberate.

- **Import-first ordering is real:** all 13 `main.ts` have `import '@x/instrumentation'` as line 1 (before `reflect-metadata`/Nest); all 13 `instrumentation.ts` call `registerTracing('<service>')`; subpath alias `@food-delivery-api/shared-observability/register` present in `tsconfig.base.json` and `knip.json`. ES side-effect-import order guarantees SDK start before http/pg are required.

- **`register.ts` never-fatal:** disabled under `NODE_ENV=test` / `TELEMETRY_ENABLED=false`; `try/catch` around SDK start; thenable-guard on `start()`; idempotent second-import no-op; SIGTERM shutdown swallows errors. Correct.

- **DRY:** the 3-/4-helper split is justified (span-wrapped inject vs no-span capture vs header-extract-run vs string-extract-run are semantically distinct). Minor shared inject-carrier core between `injectTraceContext` and `captureActiveTraceContext` is acceptable.

- **Honest framing:** comments correctly disclose that a publish-time-only injection would break trace-id continuity across the async outbox gap (the reason the column exists), and scope metrics/logs + BullMQ propagation to 8b. No overclaim of full continuity.

---

## Unresolved questions

1. Is the consumer-path behavior change (double handler+commit on a commit failure) acceptable given idempotency, or should the HIGH fix land before merge? Recommend fixing — it's a small, contained change and removes a misleading-log foot-gun.
2. Should `runWith*` distinguish "tracing disabled" from "tracing error" in the warn log to avoid alarm noise when telemetry is simply off? (Minor.)

---

**Status:** DONE_WITH_CONCERNS
**Summary:** Slice is well-built and the design/trade-offs are sound; one real defect — both `runWith*` wrappers swallow business errors and re-execute the wrapped work (empirically confirmed 2× invocation), mislabelling DB/commit failures as tracing errors. Bounded by existing idempotency, so High not Critical, but it violates the slice's own never-throw contract and is untested.
**Concerns:** Fix `runWithExtractedContext` + `runWithTraceParent` so the catch only covers tracing setup, and add a throw-propagation regression test, before merge.
