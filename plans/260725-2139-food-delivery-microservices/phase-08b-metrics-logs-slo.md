# Slice 8b — Metrics + centralized logs + SLO alerts (Prometheus/Grafana/Loki)

Context: [phase-08.md](./phase-08-ops-observability.md) · [phase-08a-distributed-tracing.md](./phase-08a-distributed-tracing.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2 — second P8 slice (after 8a tracing #29). 8c K8s, 8d CI/CD follow.
- **Status**: ✅ Verified live + adversarially reviewed (1 High + 3 fixes applied) — branch `feat/metrics-logs-slo`. Single PR. Metrics ride the SAME OTel SDK as 8a's traces (OTLP → Collector → Prometheus); golden signals from auto-instrumentation http duration; business KPIs (`orders_placed_total`, `order_revenue_cents_total`, `saga_outcome_total{outcome}`, `dlq_messages_total{topic}`) via a small `metrics.ts` meter helper; pino `trace_id`/`span_id` mixin; Loki + Alloy log shipping; Grafana provisioned (Prom/Loki/Jaeger datasources + golden-signal & business dashboards); 4 SLO alert rules + 1 telemetry-health watchdog. All under the `observability` profile, off by default.
  - **Live evidence**: placing an order → `orders_placed_total{job="order"}=1`, `order_revenue_cents_total=18000` (matches order total), `saga_outcome_total{outcome="confirmed"}=1`, plus golden-signal `http_server_request_duration_seconds_*` — all scraped by Prometheus with the correct **per-service `job` label**. All 5 alert rules load (`HighHttp5xxRate`/`HighHttpP99Latency`/`DlqMessagesGrowing`/`HighSagaFailureRatio`/`GoldenSignalMetricAbsent`). Grafana healthy with all 3 datasources; Alloy ships container stdout to Loki (7+ streams); the pino mixin adds `trace_id` to app logs (confirmed in host output). Offline: shared-observability **27** · shared-logging + shared-messaging + order suites green (**116** across the four); tsc/biome/dependency-cruiser (899 modules, 0 violations)/knip clean.
  - **Two live-verification bugs found + fixed** (would have shipped silently):
    - **Meter-provider no-op race** — with `traceExporter` + `metricReader` + auto-instrumentations all on one `NodeSDK`, the SDK's internal global-meter registration did not reliably win, so `metrics.getMeter()` (what `metrics.ts` uses) was a permanent no-op: auto-instrumentation metrics flowed but EVERY custom business metric silently vanished. Root-caused with a standalone probe (reproduced), then fixed in `register.ts`: build the `MeterProvider` explicitly, `metrics.setGlobalMeterProvider(mp)` BEFORE `sdk.start()`, give NodeSDK no metric reader (its instrumentations read the global). Re-verified live — all 3 business metrics now export.
    - **Distroless healthchecks** — the `loki`/`grafana`/`alloy` images are distroless (no shell), so their `CMD-SHELL` healthchecks could never pass, and `depends_on: service_healthy` blocked grafana + alloy from ever starting. Fixed: removed those healthchecks; dependents wait on `service_started` (prometheus keeps its working healthcheck).
- **Adversarial review + fixes applied** (report `../reports/code-reviewer-260802-0846-slice-8b-metrics-logs-slo-red-team-review-report.md`; **NO Critical** — the meter-provider fix validated sound, saga metrics verified to NOT double-count on at-least-once redelivery (`runOnce` returns undefined on duplicate → no record), cardinality bounded (only `outcome`/`topic` labels, no id/tenant), DLQ metric never-throw + post-publish):
  - **H1 (High)** — the Prometheus scrape of the Collector lacked `honor_labels: true`, so Prometheus overwrote each series' per-service `job` with `job="otel-collector"` (real name demoted to `exported_job`) → per-service dashboards collapsed to one aggregate line + 5xx/latency alerts misattributed to "otel-collector". **Fixed + verified live**: `honor_labels: true` → `job="order"` etc. preserved.
  - **M1** — a golden-signal metric rename (Renovate bumps the http instrumentation) would silently make the SLO alerts query a missing metric and never fire. **Fixed**: added a `GoldenSignalMetricAbsent` watchdog (`absent(...) for: 15m`).
  - **M2** — SIGTERM flush was fire-and-forget (final batch could be lost). **Fixed**: `await Promise.allSettled([sdk.shutdown(), meterProvider.shutdown()])`.
  - **M3** — metrics tests asserted never-throw only (why the no-op bug slipped). **Fixed**: added real in-memory-reader tests asserting increment values + exact label values.
  - Deferred/documented (Low): app-log→Loki works only once services are containers (local `nx serve` apps aren't scraped by Alloy — the mixin + Alloy→Loki pipe are each verified, full pivot lands in 8c); Grafana admin/admin dev-only.
- **Brief**: Complete the observability pane on top of 8a's OTel Collector. Extend the SAME shared `NodeSDK` to also export **metrics** (OTLP → Collector → **Prometheus**), instrument the **golden signals** (latency/traffic/errors via auto-instrumentation) plus a few **business KPIs** (orders placed, revenue, saga outcome, DLQ depth), ship **structured logs** (pino) to **Loki** correlated by `trace_id`, provision **Grafana** (Prometheus + Loki + Jaeger datasources + dashboards), and add **SLO alert rules**. One order request is then pivotable across trace (Jaeger) ↔ metrics (Grafana) ↔ logs (Loki) by the same trace id. Off by default (the heavy `observability` profile).
- **Known local-dev limitation**: services run via `nx serve` on the host (not containers until 8c), and Alloy scrapes only Docker container stdout — so app logs (which DO carry `trace_id`) don't reach Loki in LOCAL dev. Traces + metrics work fully locally; the full log↔trace pivot is exercised end-to-end once apps are containerized (8c).

## Key decisions (verify versions live before install)
- **Metrics via the SAME OTel NodeSDK, NOT a second prom-client stack** (DRY with 8a): add a `PeriodicExportingMetricReader` + `OTLPMetricExporter` (`@opentelemetry/exporter-metrics-otlp-http`, match the repo's OTel **2.10.0** core — verify) to `registerTracing` (rename intent stays; keep the function name/signature to avoid churn, or add a sibling — implementer's call, but ONE `register` entry per app). Auto-instrumentation-http already emits `http.server.request.duration` (histogram) → the golden signals (rate, errors by status, p50/p95/p99 latency) with NO extra per-handler code. Never-fatal: a down Collector must never crash boot or a request (same discipline as 8a).
- **Business KPIs via a small `metrics.ts` meter helper** in `libs/shared/observability`: expose typed instruments and wire the MINIMAL set (YAGNI — a few high-signal ones, not every field):
  - `orders_placed_total` (counter) — incremented in the place-order handler.
  - `order_revenue_cents_total` (counter) — order total on placement (or on confirm — pick one, document).
  - `saga_outcome_total{outcome=confirmed|cancelled}` (counter) — at saga terminal state.
  - `dlq_messages_total{topic}` (counter) — where the shared consumer routes a poison message to the DLQ.
  Keep labels LOW-cardinality (no order id / tenant id as labels — those are trace/log territory, not metric labels → cardinality blowup). Tenant stays OUT of metric labels.
- **Collector fan-out**: add a **metrics pipeline** to `infra/otel-collector/config.yaml` — the existing `otlp` receiver → `memory_limiter/batch` → a **`prometheus` exporter** (exposes `:8889/metrics` for Prometheus to scrape). Traces pipeline (8a) unchanged. Logs do NOT go through the Collector (simpler to ship container stdout directly — see below).
- **Logs → Loki via a pino `trace_id` mixin + a log shipper**: add a pino `mixin`/`formatters` hook in `libs/shared/logging` that reads the active OTel span (`trace.getActiveSpan()`) and adds `trace_id`/`span_id` to every log line (correlationId already present). Ship the JSON logs to **Loki** with **Grafana Alloy** (or Promtail — pick the lighter/current one, verify) scraping Docker container stdout → Loki, labelled by `service`/`container`. Loki is chosen over ELK for RAM (documented in phase-08). A log line then carries `correlation_id` + `trace_id` → Grafana Explore pivots log↔trace.
- **Grafana provisioned** (as-code, no click-ops): datasources (Prometheus, Loki, Jaeger — the last enables trace links from logs) + dashboards JSON (golden signals per service + a business-KPI board) + a Prometheus/Grafana **alert-rules** file for SLO breaches (high 5xx rate, p99 latency over budget, DLQ growth, saga failure ratio). Start MINIMAL — alert only on real SLO breach, avoid noise (phase-08 risk).
- **Compose `observability` profile extended**: add `prometheus` (scrapes Collector `:8889` + its own), `grafana` (provisioned, UI :3030 to avoid clashing app ports), `loki`, `alloy`. All under the SAME `observability` profile as 8a's collector+jaeger, OFF by default (RAM on 16GB). `.env.example` gets the new ports.
- **Sampling / cost**: metrics are cheap + always-on when telemetry is on; traces stay parent-based always-on in dev (8a). No PII in metric labels or (scrubbed) logs.

## Requirements
**Functional**: with the `observability` profile up, Prometheus scrapes every service's golden-signal + business metrics via the Collector; Grafana shows per-service golden signals + a business-KPI dashboard; logs are queryable in Loki and carry `trace_id`+`correlation_id`; a trace id from Jaeger finds the same request's logs in Loki and metrics context in Grafana; SLO alert rules fire on breach. **Non-functional**: a down Collector/Prometheus/Loki never crashes a service; metric label cardinality bounded (no ids/tenant as labels); no PII/secrets in logs or labels; profile off by default; never-fatal everywhere.

## Architecture / data flow
```
每 service (OTel NodeSDK): traces + METRICS ─OTLP─▶ OTel Collector
   Collector: traces ─▶ Jaeger (8a) ; metrics ─▶ prometheus exporter :8889
   Prometheus ─scrape :8889─▶ TSDB ; alert rules ─▶ (Grafana/Alertmanager)
pino logs (JSON, +trace_id mixin, +correlation_id) ─stdout─▶ Alloy ─▶ Loki
Grafana ◀─ Prometheus (metrics) · Loki (logs) · Jaeger (traces)   [one trace id pivots all three]
```

## Related code files
- `libs/shared/observability/src/register.ts` — add the metric reader + OTLP metric exporter to the NodeSDK (never-fatal, off under test). `metrics.ts` (new) — meter + typed business instruments (`orders_placed_total`, `order_revenue_cents_total`, `saga_outcome_total`, `dlq_messages_total`); `index.ts` exports. Deps: `@opentelemetry/exporter-metrics-otlp-http` (+ `sdk-metrics` if not transitively present) — verify vs OTel 2.10.0.
- `libs/shared/logging/*` — pino `mixin`/formatter adding `trace_id`/`span_id` from the active span (correlationId already wired). Never-throw if no active span.
- Business wiring (minimal): `apps/order` place-order handler (`orders_placed_total`, revenue), the saga terminal transition (`saga_outcome_total`), and the shared consumer's DLQ path (`dlq_messages_total`) in `libs/shared/messaging`.
- `infra/otel-collector/config.yaml` — add the metrics pipeline (otlp → prometheus exporter :8889).
- `infra/prometheus/*` (scrape config + alert rules), `infra/grafana/provisioning/*` (datasources + dashboards + alerting), `infra/loki/*` (config), `infra/alloy/*` (log-scrape config).
- `infra/docker-compose.yml` — extend `observability` profile: prometheus, grafana, loki, alloy. `.env.example` — new ports (GRAFANA_PORT, PROMETHEUS_PORT, LOKI_PORT).
- Tests: unit for the metrics helper (instruments created, increment doesn't throw with no provider) + the pino trace_id mixin (adds ids when a span is active, no-throw when not). E2E/manual: place an order → metric counters move in Prometheus + logs in Loki carry the trace id.

## Implementation steps
1. Metrics SDK: add metric reader + OTLP metric exporter to `register.ts` (never-fatal, off under test); `metrics.ts` business instruments + exports. Verify OTel metric-exporter version vs 2.10.0.
2. Wire the minimal business metrics (order placed + revenue, saga outcome, DLQ depth). Low-cardinality labels only.
3. pino `trace_id`/`span_id` mixin in `shared-logging` (never-throw).
4. Collector metrics pipeline (prometheus exporter :8889). Prometheus scrape config + SLO alert rules.
5. Loki + Alloy (scrape Docker stdout → Loki). Grafana provisioned datasources (Prometheus/Loki/Jaeger) + dashboards (golden signals + business KPIs) + alert rules.
6. Extend the `observability` compose profile (prometheus/grafana/loki/alloy) + `.env.example` ports.
7. Verify: profile up → Prometheus scrapes; place an order → counters move + logs in Loki carry trace_id; one trace id pivots trace↔logs↔metrics; an SLO alert rule evaluates. Unit tests for the helper + mixin.
8. Update plan before push; PR.

## Todo
- [x] metrics on the shared NodeSDK (explicit MeterProvider + `setGlobalMeterProvider`, never-fatal, off under test) + `metrics.ts` business instruments + exported
- [x] golden signals (auto-instr http duration) + minimal business KPIs wired (orders/revenue/saga-outcome/DLQ), low-cardinality labels (`outcome`/`topic` only), no PII/id/tenant labels
- [x] pino `trace_id`/`span_id` mixin in shared-logging (never-throw, correlationId already present) — confirmed adding trace_id to app logs
- [x] Collector metrics pipeline (prometheus exporter :8889); Prometheus scrape (`honor_labels` per-service `job`) + 4 SLO rules + 1 telemetry watchdog
- [x] Loki + Alloy (Docker stdout → Loki, distroless-safe deps) ; Grafana provisioned datasources (Prom/Loki/Jaeger) + golden-signal & business dashboards
- [x] `observability` compose profile extended (prometheus/grafana/loki/alloy) + `.env.example` ports; off by default
- [x] unit: metrics helper (real in-memory export + label assertions) + pino mixin (never-throw); live: place order → business + golden metrics in Prometheus per-service; logs carry trace_id (host); container-log→Loki pipe works
- [x] biome/cruiser/knip/tsc — all green; plan updated before push

## Success criteria
- With the `observability` profile up: Prometheus scrapes every service's golden-signal + business metrics; Grafana renders per-service golden signals + a business-KPI dashboard; placing an order moves the counters.
- Logs are queryable in Loki and carry `trace_id`+`correlation_id`; a Jaeger trace id finds the same request's logs (Grafana Explore) — trace↔log↔metric pivot works.
- At least one SLO alert rule is defined + evaluates (e.g. 5xx-rate / p99-latency / DLQ-growth / saga-failure).
- A down Collector/Prometheus/Loki never crashes a service; metric labels are bounded (no id/tenant labels); profile off by default.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Metric label cardinality blowup (id/tenant as label) | M×H | Only low-cardinality labels (topic, outcome, status class); ids/tenant live in traces/logs, never metric labels; review |
| Observability stack RAM on 16GB (Prom+Graf+Loki+Alloy+Jaeger+Collector) | H×M | All under `observability` profile, off by default; bring up deliberately; Loki over ELK; resource-light images |
| Collector/Prometheus/Loki down crashes a service | L×H | Metric export never-fatal (same as 8a traces); pino mixin never-throws; log shipping is out-of-process (Alloy) |
| Over-alerting noise | M×L | Alert only on real SLO breach; start with a minimal rule set; document thresholds |
| PII/secrets in logs or labels | L×H | No bodies/secrets logged; scrub; no tenant/id in metric labels; Loki/Grafana dev-only, internal network |
| Log↔trace correlation missing (no trace_id in logs) | M×M | pino mixin injects trace_id from the active span; verify a log line in Loki carries it + links to Jaeger |

## Security considerations
- No PII/secrets in metric labels or log lines (scrub; ids/tenant excluded from labels). Grafana/Prometheus/Loki internal-network + dev-exposed only, never via Nginx; access-controlled in K8s (8c).
- Metric/label cardinality bounded to prevent a tenant/id from exploding the TSDB.
- Trace/correlation ids are not tenant data; a shared Grafana view is fine in dev — per-tenant access control is a prod (K8s) concern (documented).

## Next steps
8c: K8s manifests per app + HPA (CPU + custom metric e.g. Kafka lag / RPS — this slice's metrics feed the HPA) + Kustomize overlays + canary/blue-green. 8d: GitHub Actions CI/CD + Trivy/Hadolint/actionlint + Renovate. BullMQ job trace/metric propagation if still deferred.
