# Phase 8 — Ops & Observability

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2
- **Status**: Not started
- **Brief**: Make the system operable + observable. K8s manifests + HPA autoscaling, Blue-Green/Canary deploy, GitHub Actions CI/CD. Full observability: OpenTelemetry tracing → Jaeger, Prometheus/Grafana metrics, Loki centralized logs. Instrumentation was stubbed early (P0 logging/correlation ID) — now fully wired end-to-end.

## Key insights
- Correlation ID (P0) + OTel context = one request traced across gateway→services→Kafka→workers in Jaeger. This is the payoff of propagating context since P0.
- Single OTel Collector is the only OTLP sink; it fans out traces→Jaeger, metrics→Prometheus, logs→Loki. Vendor-neutral, swappable.
- On 16GB, the `observability` profile is heavy — run it deliberately, not always. In K8s it's a proper namespace.
- Golden signals per service: latency, traffic, errors, saturation. HPA scales on CPU + custom metrics (queue depth, RPS).

## Requirements
**Functional**: distributed trace of a full order across services in Jaeger; Grafana dashboards (golden signals + business KPIs); centralized queryable logs in Loki correlated by trace/correlation ID; K8s deploy with HPA; CI/CD pipeline; canary/blue-green rollout.
**Non-functional**: trace sampling configurable; dashboards + alerts for SLOs; CI runs `nx affected` build/test/lint; rollout with health-gated promotion + rollback.

## Architecture
- `libs/shared/observability` (created P0, completed here): OTel SDK bootstrap, auto-instrumentation (HTTP/gRPC/Kafka/Postgres/Redis), trace-context propagation into Kafka headers + BullMQ jobs.
- `observability` compose profile: OTel Collector, Jaeger all-in-one, Prometheus, Grafana, Loki, Grafana Alloy (log shipper).
- K8s: Deployment/Service/HPA per app; Ingress (mirrors Nginx L7); ConfigMap/Secret; Kustomize overlays (dev/prod); canary via progressive traffic or blue-green via service switch.
- CI/CD (GitHub Actions): lint→`nx affected` build+test→build/push images→deploy (env-gated) with health checks.

## Related code files (to create)
- `libs/shared/observability/*` — OTel bootstrap, propagators, metric helpers (finalize)
- `infra/otel-collector/config.yaml`, `infra/prometheus/*`, `infra/grafana/dashboards/*`, `infra/loki/*`, `infra/alloy/*`
- `infra/k8s/*` — per-app Deployment/Service/HPA/Ingress, Kustomize overlays, canary/blue-green manifests
- `.github/workflows/*` — CI (lint/build/test) + CD (image build/push/deploy)

## Implementation steps
1. Finalize `shared/observability`: OTel SDK + auto-instrumentation in every app; propagate trace context through Kafka headers + BullMQ jobs (extend correlation-ID plumbing from P0).
2. Add `observability` profile: OTel Collector (OTLP in → Jaeger/Prometheus/Loki out), Jaeger, Prometheus, Grafana, Loki, Alloy.
3. Grafana dashboards: golden signals per service + business KPIs (orders, revenue, saga success rate, DLQ depth). Alert rules for SLO breaches.
4. Ship logs via Alloy → Loki; ensure logs carry trace_id + correlation_id for pivoting.
5. K8s manifests per app + HPA (CPU + custom metric e.g. Kafka lag / RPS); Kustomize dev/prod overlays.
6. Canary or blue-green rollout with health-gated promotion + automatic rollback.
7. GitHub Actions: CI (biome → cruiser → knip → `nx affected` build/test → Trivy image+config scan → Hadolint Dockerfiles → actionlint workflows) + CD (build/push images, deploy with health gate). Enable Renovate app for dependency + Docker-tag PRs.
8. E2E: place an order, then open Jaeger and follow one trace gateway→order→saga→inventory→payment→notification; verify metrics + logs correlate by trace id; trigger HPA under load; run a canary rollout + rollback.

## Todo
- [ ] OTel SDK + auto-instrumentation in all apps; trace context through Kafka + BullMQ
- [ ] observability profile (Collector/Jaeger/Prometheus/Grafana/Loki/Alloy)
- [ ] Grafana golden-signal + business dashboards + SLO alerts
- [ ] logs → Loki correlated by trace/correlation id
- [ ] K8s manifests + HPA + Kustomize overlays
- [ ] canary/blue-green rollout + rollback
- [ ] GitHub Actions CI/CD (nx affected) + Trivy/Hadolint/actionlint scans + Renovate enabled
- [ ] E2E: end-to-end trace, correlated logs/metrics, HPA, canary+rollback

## Success criteria
- A single order request is fully traceable across all involved services in Jaeger, with logs (Loki) and metrics (Grafana) pivotable by the same trace/correlation id.
- HPA scales a service up under load and back down.
- Canary rollout promotes on healthy metrics and auto-rolls-back on failure; CI runs only affected projects.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Observability stack RAM on 16GB | H×M | Deliberate profile; sample traces; in K8s use resource limits |
| Trace context lost across async (Kafka/BullMQ) | M×H | Explicit propagator inject/extract in message headers; tests assert continuity |
| K8s local resource limits | M×M | Use k3d/kind minimal; scale replicas to 1 locally; cloud for full demo |
| Over-alerting noise | M×L | Alert only on SLO breach; start minimal |

## Security considerations
- Scrub PII/secrets from traces + logs (redaction in Collector/log pipeline).
- Secrets via K8s Secrets (not ConfigMaps); least-privilege service accounts; network policies between namespaces.
- Dashboards/traces access-controlled; no tenant data leakage across tenants in shared dashboards.

## Documented alternatives (not chosen — RAM trade-off on 16GB)
- **Tracing**: Grafana Tempo instead of Jaeger → single LGTM pane, less standalone UI to learn.
- **Logs**: ELK (Elasticsearch + Kibana) instead of Loki → reuses the search ES cluster, but Kibana + ES-logs add ~2GB+ and risk OOM when the full stack runs. Default stays Loki for RAM safety.

## Next steps
System complete. Follow-ups: chaos testing, cost/perf tuning, real payment/SMS/push providers via existing adapter interfaces, multi-region design.
