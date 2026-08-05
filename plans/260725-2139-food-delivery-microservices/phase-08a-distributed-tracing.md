# Slice 8a — Distributed tracing (OpenTelemetry → Jaeger)

Context: [phase-08.md](./phase-08-ops-observability.md) · [phase-00-foundation-monorepo-catalog.md](./phase-00-foundation-monorepo-catalog.md) · [phase-03c.md](./phase-03c-order-saga-events.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2 — first P8 slice (the observability foundation; dashboards/logs 8b, K8s 8c, CI/CD 8d follow).
- **Status**: ✅ Verified live + adversarially reviewed (1 High fixed) — branch `feat/otel-tracing`. Single PR. OpenTelemetry wired into all 13 apps (`libs/shared/observability`: `registerTracing` NodeSDK + auto-instrumentations + OTLP-HTTP exporter, never-fatal; import-first per-app `instrumentation.ts`); manual W3C propagation across the async Kafka saga; `observability` compose profile (OTel Collector → Jaeger, off by default). **Full single-trace continuity achieved across BOTH async boundaries** the plan called out:
  - **Kafka outbox gap** — every saga message is published via the polling outbox (row written in-tx, published later by an unrelated relay tick), so span context can't survive to publish time. Fixed by persisting the `traceparent` as a nullable `trace_parent varchar(64)` column on `{order,payment,inventory,review}_outbox`, captured at `OutboxWriter.append()` (synchronous, in the request/consumer span) and forwarded in `fetchUnpublished()` → the producer's `if (!headers.traceparent)` guard forwards it unchanged → the consumer parents to the original span.
  - **Temporal gap** — payment's reply is emitted from a Temporal activity on a detached worker (no ambient OTel context). Fixed by threading the `traceparent` as a plain workflow-input field (captured at `startCharge` inside the ChargePayment consumer span → forwarded through the deterministic workflow → the `emitReply` activity re-activates it via `runWithTraceParent` around the outbox write). **Deliberately NOT** `@temporalio/interceptors-opentelemetry` — it hard-depends on `@opentelemetry/{core,resources,sdk-trace-base}@^1.25.1` vs the repo's OTel **2.10.0** (major conflict → two cores mixing → silent context loss); string-passthrough matches how the workflow already threads correlationId/tenantId, is sandbox-safe, and needs zero new deps.
  - **Live evidence**: placing an order yields ONE Jaeger trace of **113 spans across all 5 services** (order 68 · inventory 18 · catalog 6 · payment 7 · notification 14) under a single trace id — `POST /orders` → catalog gRPC → ReserveStock→inventory → reply → ChargePayment→payment → Temporal StartWorkflowExecution → PaymentSucceeded → order → OrderConfirmed→notification (email + pg). Before the fixes: 2 disconnected traces (83 + 28 spans) split at the Temporal boundary. All four outbox tables carry the same trace id; `payment_outbox.trace_parent` (Temporal-emitted) — previously NULL — now carries it. The 4 migrations applied cleanly to the live DBs (additive nullable, metadata-only). Offline gates: shared-observability **18** · payment **31** · order **86** · inventory **19** · review **31** · shared-messaging **30**; tsc/biome/dependency-cruiser (893 modules, 0 violations)/knip all clean.
- **Adversarial review + fix applied** (report `../reports/code-reviewer-260731-1012-slice-8a-distributed-tracing-red-team-review-report.md`; **NO Critical** — register never-fatal + import-first verified, producer guard + null-handling correct, Temporal determinism/idempotency sound, migrations safe/reversible, no PII in spans, honest framing on the deferred BullMQ/metrics scope):
  - **H1 (High)** — `runWithExtractedContext` (base) and `runWithTraceParent` (Temporal fix) both ran the wrapped **business** `fn` *inside* the `try` whose `catch` ended with `return fn()`, so a handler/DB error was mislabelled as a tracing failure AND re-executed the handler a second time (bounded by idempotency, but a real behavior + on-call-noise regression). **Fixed**: the `catch` now covers only the tracing *setup*; `fn` runs once outside it (span ended in `finally`), so business errors propagate exactly once. Regression tests added (throw → called once, both helpers).
- **Brief**: Wire **OpenTelemetry** into every app so a single request — place an order at the gateway — produces ONE distributed trace spanning gateway → order → gRPC (inventory/catalog) → **Kafka saga** (ReserveStock/ChargePayment/replies) → payment/inventory → notification, viewable in **Jaeger**. HTTP/gRPC/Postgres/Redis spans come from auto-instrumentation; the **async Kafka hops** need MANUAL W3C `traceparent` propagation through the event envelope so the trace doesn't break at each producer→consumer boundary — the real learning + the payoff of the correlation-id plumbing carried since P0.

## Key decisions (verify versions live)
- **`@opentelemetry/sdk-node@0.221.0` + `@opentelemetry/auto-instrumentations-node@0.79.0`** (+ `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/api`) — verify live before install. Auto-instrumentation covers HTTP/Express, gRPC, `pg`, `ioredis` (→ automatic spans for the gateway→service HTTP, order→inventory/catalog gRPC, DB + Redis calls). NestJS is Express under the hood → covered.
- **Manual Kafka propagation** (the crux): `@confluentinc/kafka-javascript` (the KafkaJS-compat facade this repo uses) is NOT auto-instrumented. So the shared producer INJECTS the active context as a `traceparent` (+ `tracestate`) header on every published message, and the shared consumer EXTRACTS it and runs the handler inside that context (a new CONSUMER span linked as a child of the producing span). Reuse the existing `event-envelope` header plumbing (it already carries correlationId) — add the W3C trace headers alongside. This keeps the order saga (order→payment→inventory over `*.commands`/`*.replies`/`*.events`) as ONE connected trace.
- **BullMQ propagation** (media thumbnails / notification sends): inject traceparent into the job payload/opts on enqueue, extract in the worker. Include if cheap; otherwise a documented follow-up — the headline is the Kafka saga trace.
- **`libs/shared/observability`** (new lib): `register.ts` (a side-effecting bootstrap that starts the `NodeSDK` with auto-instrumentations + an OTLP-HTTP trace exporter to the Collector + a resource with `service.name` from an env/arg — MUST run BEFORE Nest/other imports so instrumentation can patch modules), `kafka-trace-propagation.ts` (`injectTraceContext(headers)` / `withExtractedContext(headers, fn)` using the OTel propagation API), a `TELEMETRY_SERVICE_NAME`/`OTEL_EXPORTER_OTLP_ENDPOINT` env contract. Never crash a service if the Collector is down (exporter failures are logged, not fatal).
- **Bootstrap wiring**: each app's `main.ts` imports the observability register FIRST (before `NestFactory`/app imports) — e.g. `import '@food-delivery-api/shared-observability/register'` or a tiny per-app `instrumentation.ts` imported first — so http/grpc/pg/ioredis are patched before use. `service.name` per app.
- **`observability` compose profile**: **OTel Collector** (OTLP gRPC/HTTP in → export to Jaeger) + **Jaeger all-in-one** (UI :16686). Prometheus/Grafana/Loki are 8b — 8a is traces only. OFF by default (RAM); brought up deliberately.
- **Sampling**: parent-based always-on in dev (see every trace); configurable ratio via env for later. PII: no request bodies in spans (auto-instr defaults don't capture bodies; don't add attributes carrying tenant PII).

## Requirements
**Functional**: with the `observability` profile up, placing an order yields ONE trace in Jaeger spanning gateway→order→gRPC→Kafka-saga→payment/inventory→notification, all under one trace id; the trace id correlates with the existing correlationId. **Non-functional**: trace context survives the async Kafka boundary (producer→consumer linked); a down Collector never crashes a service (export failures non-fatal); no PII/secrets in span attributes; the profile is off by default.

## Architecture / data flow
```
client ─▶ gateway (HTTP span) ─▶ order (HTTP span) ─ gRPC ▶ inventory/catalog (auto span)
   order ─produce ReserveStock/ChargePayment (INJECT traceparent header)─▶ Kafka
        inventory/payment consumer ─EXTRACT traceparent → CONSUMER span (child)─▶ handler ─ pg/redis spans
        replies + OrderConfirmed → notification consumer (EXTRACT) → send span
All spans → OTLP → OTel Collector → Jaeger (one trace id, correlated with correlationId)
libs/shared/observability register.ts runs FIRST in every main.ts (patches http/grpc/pg/ioredis)
```

## Related code files
- `libs/shared/observability/*` — new lib: `register.ts` (NodeSDK bootstrap + auto-instrumentations + OTLP exporter + resource; side-effecting, import-first), `kafka-trace-propagation.ts` (inject/extract W3C context ↔ Kafka headers via `@opentelemetry/api` propagation), `index.ts`. Register lib (alias, tags, commitlint scope `shared-observability`, knip). Deps: `@opentelemetry/{sdk-node,auto-instrumentations-node,exporter-trace-otlp-http,api}`.
- Every app `main.ts` (gateway, catalog, auth, inventory, order, payment, search, delivery, media, notification, config, review, analytics) — import the register FIRST + set `service.name`. Env schema (base or per-app): `OTEL_EXPORTER_OTLP_ENDPOINT` (default the Collector), `OTEL_TRACES_SAMPLER`/ratio, `TELEMETRY_ENABLED` (off under test).
- `libs/shared/messaging/*` — the producer/outbox-relay injects traceparent into published headers; the consumer subscriber extracts + runs the handler inside the context (a consumer span). Reuse `event-envelope`.
- (optional) `libs/shared/*` BullMQ enqueue/worker (media/notification) — inject/extract job trace context.
- `infra/docker-compose.yml` — `observability` profile: `otel-collector` (config `infra/otel-collector/config.yaml`: OTLP receiver → Jaeger exporter) + `jaeger` (all-in-one, UI 16686). `.env.example` — OTEL_* keys.
- e2e / manual: place an order with the stack + observability up → assert (or manually verify) one Jaeger trace spans the services; a lib unit test asserts inject→extract round-trips the context.

## Implementation steps
1. Add OTel deps; `libs/shared/observability` (register + kafka propagation + never-fatal exporter).
2. Wire the register first in every app main.ts + `service.name`; env (OTEL_*, TELEMETRY_ENABLED off in test).
3. Kafka propagation in the shared producer (inject) + consumer (extract → consumer span) via the envelope headers.
4. `observability` compose profile (OTel Collector → Jaeger) + collector config + `.env.example`.
5. (If cheap) BullMQ job context propagation.
6. Verify: place an order → one connected trace in Jaeger; unit test the inject/extract round-trip.
7. Update plan before push; PR.

## Todo
- [x] OTel deps + `libs/shared/observability` (register: NodeSDK + auto-instr + OTLP exporter, never-fatal; kafka inject/extract/capture/run-with-traceparent) + registered
- [x] register wired FIRST in every app main.ts (per-app `instrumentation.ts`, line 1) + per-app service.name + OTEL_* env (off under test/`TELEMETRY_ENABLED=false`)
- [x] Kafka trace-context propagation in the shared producer (inject-if-absent) + consumer (extract → child consumer span)
- [x] outbox `trace_parent` persistence across order/payment/inventory/review (capture at append → forward in fetchUnpublished) — closes the async outbox gap
- [x] Temporal traceparent propagation (workflow-input passthrough → `runWithTraceParent` in emit-reply activity) — closes the Temporal boundary; NO version-conflicting interceptor package
- [x] `observability` compose profile: OTel Collector (→ Jaeger) + Jaeger all-in-one + collector config + .env.example
- [x] unit: inject→extract→capture→run-with-traceparent round-trip + throw-propagation (fn runs once); register never crashes on a down Collector
- [x] E2E/manual: place an order → ONE Jaeger trace (113 spans) spans order→gRPC→Kafka-saga→payment(Temporal)/inventory→notification under one trace id
- [x] biome/cruiser/knip/tsc; plan updated before push

## Success criteria
- With the `observability` profile up, one order request appears in Jaeger as a SINGLE trace crossing gateway → order → gRPC → the Kafka saga → payment/inventory → notification, under one trace id that lines up with the correlationId.
- The trace does NOT break at a Kafka producer→consumer boundary (manual propagation works).
- A down OTel Collector never crashes a service (exporter failures non-fatal); the profile is off by default.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Trace context lost across Kafka/BullMQ | M×H | Explicit W3C inject/extract in message headers/job; unit test the round-trip; consumer span links to producer |
| register not import-first → instrumentation misses modules | M×H | A dedicated first import in each main.ts (before Nest/app); document + verify spans appear |
| Observability stack RAM on 16GB | H×M | `observability` profile off by default; Jaeger all-in-one only (no Prom/Grafana/Loki in 8a); sample configurable |
| Collector down crashes a service | L×H | Exporter failures logged, non-fatal; SDK start wrapped so a bad endpoint never aborts boot |
| PII in span attributes | L×M | No request bodies (auto-instr default); don't add tenant-PII attributes; redaction note for the Collector (8b) |

## Security considerations
- No PII/secrets in span attributes (no bodies captured; correlation/trace ids + coarse attributes only). Collector-side redaction is an 8b hardening.
- OTel Collector + Jaeger internal-network only, dev-exposed UI, never via Nginx; access-controlled in K8s (P8 later).
- Trace ids are not tenant data; a shared Jaeger view is fine in dev — per-tenant access control is a prod concern (documented).

## Next steps
8b: Prometheus/Grafana metrics (golden signals + business KPIs) + Loki logs correlated by trace_id + SLO alerts. 8c: K8s + HPA + canary. 8d: GitHub Actions CI/CD + Trivy/Hadolint/actionlint + Renovate. BullMQ trace propagation if deferred here.
