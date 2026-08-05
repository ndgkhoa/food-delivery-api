# Red-Team Review — Slice 8b: Metrics + Centralized Logs + SLO Alerts

Branch `feat/metrics-logs-slo` (uncommitted). Reviewer: code-reviewer. Date: 2026-08-02.

## Scope
- Code: `register.ts`, `metrics.ts`(+spec), `trace-context.mixin.ts`(+spec), `logging.module.ts`, 2 saga reply handlers, `place-order.handler.ts`, `kafka-consumer.ts`, index barrels.
- Infra: `otel-collector/config.yaml`, `prometheus/{prometheus.yml,alert-rules.yml}`, `loki/`, `alloy/`, `grafana/`, `docker-compose.yml`, `.env.example`.
- Focus: cardinality, never-throw, saga double-count, meter-provider fix, SLO PromQL correctness, PII, compose sanity.

## Overall Assessment
Strong slice. The meter-provider fix is correct and well-reasoned; never-throw discipline is consistent; label cardinality is clean; the saga double-count analysis holds up (no inflation on redelivery). One real **High** defect: the golden-signal per-service split collapses to a single `job` in Prometheus. Rest are Medium/Low robustness + honesty notes. No Critical.

---

## Critical
None.

---

## High

### H1 — `sum by (job)` collapses ALL services under `job="otel-collector"` (per-service dashboards + alert attribution broken)
`infra/prometheus/prometheus.yml:15-17` scrapes the Collector with `job_name: otel-collector` and **no `honor_labels: true`**. Prometheus default `honor_labels: false` forces `job="otel-collector"` onto every scraped series, renaming any target-supplied `job` (the Collector's prometheus exporter derives `job` from each service's `service.name` to disambiguate resources) to `exported_job`.

Consequences:
- `infra/grafana/dashboards/golden-signals-per-service.json` — every panel is `sum by (job) (...)` / `sum by (job, le) (...)`. With `job` constant, the "per-service" dashboard renders a **single aggregate line**, not one per service — its headline purpose is unmet.
- `infra/prometheus/alert-rules.yml:11-32` — `HighHttp5xxRate` / `HighHttpP99Latency` still FIRE in aggregate (SLO breach is detected), but the annotation `on {{ $labels.job }}` always says **"otel-collector"** — you cannot tell which of the 13 services is failing.

Why live-verification missed it: with one service under test there is nothing to split; the collapse only shows once ≥2 services emit HTTP metrics.

**Repro:** run 2 services under the `observability` profile, drive 5xx on one, open the per-service dashboard → one merged series; fire the alert → annotation names `otel-collector`.

**Fix (one line):** add `honor_labels: true` to the `otel-collector` scrape job so the exporter's `job=<service.name>` is preserved; `by (job)` then splits per service. Verify against the live `:8889/metrics` that the per-service label is `job` (if the exporter instead exposes it only via `target_info`/`resource_to_telemetry_conversion`, enable `resource_to_telemetry_conversion: {enabled: true}` on the Collector's `prometheus` exporter and switch `by (job)` → `by (service_name)` in both dashboards and the two HTTP alert rules). The business-KPI dashboard and `HighSagaFailureRatio`/`DlqMessagesGrowing` are unaffected (they group by `outcome`/`topic` or globally).

---

## Medium

### M1 — Golden-signal metric names are silently coupled to `instrumentation-http@0.221.0`; a Renovate bump can break the HTTP alerts with no signal
The alert/dashboard names `http_server_request_duration_seconds_*` are **correct for the pinned 0.221.0** — that exact version made stable HTTP semconv (`http.server.request.duration`, seconds) the ONLY output and removed `OTEL_SEMCONV_STABILITY_OPT_IN` / the old `http.server.duration` (ms). Verified via the opentelemetry-js experimental changelog.

Risk: this repo runs Renovate with exact pins. A future instrumentation-http rename/suffix change → the PromQL queries a **non-existent** series → `HighHttp5xxRate`/`HighHttpP99Latency` silently never fire (a query on a missing metric is not an error). `alert-rules.yml:1-7` already flags the uncertainty in a comment, but there is no guard.

**Fix:** add a cheap watchdog alert, e.g. `absent(http_server_request_duration_seconds_count) for: 15m` (warning), so a name drift pages instead of going dark. Optionally add a Renovate group note that bumping `@opentelemetry/instrumentation-http` requires re-checking these metric names.

### M2 — SIGTERM telemetry flush is fire-and-forget; final metric/span batch can be lost
`register.ts:130-141` calls `sdk.shutdown()` and `meterProvider.shutdown()` inside `process.once('SIGTERM')` without awaiting. If nothing else keeps the loop alive, the process can exit before the async flush resolves, dropping the last (≤15s) metric window and any un-exported spans. Best-effort telemetry, so not fatal, but the "flush on the way out" intent in the comment isn't actually guaranteed.

**Fix:** make the handler `async` and `await Promise.allSettled([sdk.shutdown(), meterProvider.shutdown()])` (both already never reject), or register via Nest's shutdown hooks which await. Low effort, matches stated intent.

### M3 — `metrics.spec.ts` asserts only never-throw, never the increment/label
`metrics.spec.ts` covers "doesn't throw" (no provider + throwing meter) but never registers a real in-memory `MeterProvider`+reader to assert `orders_placed_total` increments by 1, `revenue` adds the cents, and `outcome`/`topic` labels attach with the right values. The mixin spec (`trace-context.mixin.spec.ts`) *does* exercise a real provider — the metrics spec should mirror it. Label correctness is currently only guaranteed by live verification, not by a regression test.

**Fix:** add one test with `PeriodicExportingMetricReader`/`InMemoryMetricExporter` (or a `MetricReader` collect) asserting the counter value + attributes after `recordSagaOutcome('cancelled')`.

---

## Low / Informational

- **L1 — app-log→Loki honesty (framing):** `.env.example` advertises "Grafana (dashboards + Loki logs)" and the alloy/compose comments say Alloy "ships every container's stdout". True for containers, but in LOCAL dev the apps run on the host via `nx serve`, so **app logs don't reach Loki until 8c**. The known/accepted limitation is real; the wording just doesn't say it. Add one clause ("container logs only; app logs arrive once services are containerized in 8c") to avoid a reader assuming app-log search works locally. Not a code defect.
- **L2 — Grafana `admin/admin`:** `docker-compose.yml` + `.env.example` default dev creds, commented "dev only". Fine for the off-by-default `observability` profile; ensure 8c/prod overrides `GRAFANA_ADMIN_PASSWORD` and does not expose Grafana/Prometheus/Loki without an auth proxy (currently direct host ports, acceptable for dev).
- **L3 — Loki derived field:** `datasources.yaml:34-38` sets `url: '${__value.raw}'` alongside `datasourceUid: jaeger`. For an internal trace link the `url` is usually omitted (the matched value is passed as the trace query). Verify the "TraceID → Jaeger" link actually resolves in Explore; if it 404s, drop `url`. Cosmetic.
- **L4 — no `metric_relabel_configs`/`instance` hygiene:** once H1 is fixed, confirm `instance` isn't exploding cardinality (Collector may synthesize one per resource); for dev scope it's fine.

---

## Validated (fixes/claims confirmed sound)

- **Meter-provider fix (register.ts:80-102) — CORRECT.** Building `MeterProvider` explicitly + `metrics.setGlobalMeterProvider(mp)` before `sdk.start()`, with NodeSDK given no `metricReader`, is sound: NodeSDK only touches the global meter provider when it's configured with a reader/exporter, so it won't clobber ours; auto-instrumentations resolve their meter from the global → same provider → single export path (no duplication). Same `resource` object shared by both → consistent `service.name`. Matches the live-verified result (business + auto metrics both export). Idempotent second-import guard (`if (sdk) return`) is fine; registration is synchronous so no double-registration race.
- **Saga double-count — NO inflation.** `recordSagaOutcome` fires only `if (outcome)`, and `outcome` is the return of `runInTransaction(() => IdempotentConsumer.runOnce(...))`. `runOnce` returns `undefined` on `DuplicateEventError` (`idempotent-consumer.ts:47-49`) AND `apply` returns `undefined` on any stale-state no-op. So a redelivered/at-least-once `PaymentSucceeded`/`StockReserved`/`StockReleased` reply records nothing. Metric sits *outside* the tx but is gated on the deduped result → correct. Each terminal saga records exactly once: confirmed (payment success), cancelled once via `StockReservationFailed` OR via `StockReleased` (payment-fail → compensation). Payment-fail leg returns `undefined` (records later on release) — no miss, no double. Worst case is an *under*count (crash between commit and record) — acceptable, never inflates.
- **Label cardinality — CLEAN.** `orders_placed_total`/`order_revenue_cents_total` unlabeled; `saga_outcome_total{outcome}` 2-value bounded domain; `dlq_messages_total{topic}` bounded by the fixed source-topic set (`raw.topic`, never the message/order id, never `.dlq`). No order/tenant/user/correlation id in any label.
- **Never-throw on DLQ path (kafka-consumer.ts:128).** `recordDlqMessage` is wrapped in its own try/catch and returns void, placed after a successful `publish` and before `return true`; even a hypothetical throw couldn't reach the outer catch to trigger a duplicate DLQ publish. Safe.
- **pino mixin — never-throw + cheap.** `traceContextMixin` is a single `trace.getActiveSpan()?.spanContext()` read, try/catch-guarded, returns `{}` when no span. Wired via `mixin` in `logging.module.ts` (valid pino option, forwarded by pino-http). Runs per-line but O(1). Good.
- **Distroless healthcheck fix — SOUND.** loki/grafana/alloy carry no healthcheck (distroless, no shell); no dependent gates on their `service_healthy` — grafana→prometheus(`service_healthy`)+loki(`service_started`), alloy→loki(`service_started`). Prometheus keeps its working `wget` probe. Transient Grafana datasource failures self-heal on retry. No dependency can deadlock on an unsatisfiable probe.
- **Ports — no clash.** New host ports 9090/3100/8889/3030 each appear once; Grafana deliberately on 3030 (not 3000). Alloy Docker socket mounted `:ro`. `observability` profile off by default.
- **PII/secrets — none** in logs (mixin adds only trace/span ids; `redact` keeps authorization/cookie), metric labels, or collector config.
- **No dead code / knip:** all four `metrics.ts` exports + `SagaOutcome` are consumed (place-order, both saga handlers, kafka-consumer).

---

## Metrics
- Type coverage: N/A (strict TS, typed throughout the diff).
- Test coverage: mixin well-covered; `metrics.ts` never-throw-only (see M3).
- Linting: not run (review-only, no edits).

## Unresolved Questions
1. On the live `otel-collector:8889/metrics`, is the per-service label emitted as `job` (→ `honor_labels: true` fixes H1) or only via `target_info`/needs `resource_to_telemetry_conversion` (→ group by `service_name`)? Decides the exact H1 fix.
2. Is `service.instance.id` set anywhere? If not, confirm the exporter's synthesized `instance` doesn't create surprising series once H1 is fixed.
