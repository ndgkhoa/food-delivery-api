# Slice 8c-B — HPA autoscaling + canary/blue-green rollout + graceful shutdown

Context: [phase-08.md](./phase-08-ops-observability.md) · [phase-08c-a-k8s-manifests-dockerfiles.md](./phase-08c-a-k8s-manifests-dockerfiles.md) · [phase-08b-metrics-logs-slo.md](./phase-08b-metrics-logs-slo.md)

## Overview
- **Priority**: P2 — second 8c sub-slice (after 8c-A manifests #31). 8d CI/CD follows; completes the K8s deploy story.
- **Status**: ✅ Verified live (k3d) + adversarially reviewed (1 High + 1 Medium fixed) — branch `feat/hpa-canary-rollout`. Single PR. CPU HPA (autoscaling/v2, 13 services) + a custom-metric path via prometheus-adapter; blue-green (Service-selector) + canary (Traefik weighted); fleet-wide graceful shutdown (the 5 remaining `enableShutdownHooks` + a base-patch `preStop`+`terminationGracePeriodSeconds` on all 13).
  - **Live evidence (k3d, metrics-server + Traefik)**:
    - **CPU HPA** — under `ab` load the gateway HPA read cpu **500%/70%** and scaled **1→2→4 pods**, served **467,694 requests with 0 failed**, then scaled back to **1** once load stopped (behavior stabilization). Fully proven.
    - **Canary** — 200 requests through the Traefik weighted `TraefikService` split **180 stable / 20 canary** = exactly the configured **90/10**.
    - **Blue-green** — patching the `gateway` Service selector `version: blue→green` moved traffic **30/0 → 0/30** (atomic cutover), rollback by flipping back.
    - **Rolling-update drain** — a live `rollout restart` of the active deployment under continuous load returned **600/600 HTTP 200 (zero dropped)** — the `preStop sleep 5` + `terminationGracePeriodSeconds 30` + startupProbe deliver zero-downtime.
    - **Graceful shutdown** — the 5 rebuilt services run with hooks; all 13 Deployments carry preStop+grace (verified in the drain test).
    - **Custom-metric HPA** — infrastructure verified: prometheus-adapter registers `custom.metrics.k8s.io` (**APIService Available=True**) and in-cluster Prometheus ingests the source metric. But it does NOT serve a value end-to-end: the metric flows app→OTLP→collector→Prometheus-scrapes-collector (the 8b OTLP-native pipeline), so series carry `job` (=service.name) but **no `namespace`/`pod` labels**, and the adapter's standard `seriesQuery{namespace!="",pod!=""}` matches nothing. Documented in the adapter configmap with two fix paths (collector **k8sattributes** processor + `resource_to_telemetry_conversion`, or a direct pod-scrape). The **CPU HPA carries the autoscaling success criterion**; the plan explicitly allowed validating the custom metric without a full live demo.
    - Offline: 245 tests, tsc/biome/dependency-cruiser (0 violations)/knip clean; kustomize dev **71/71** + prod **64/64** + observability **18/18** kubeconform; canary dry-run validated against the cluster's real `traefik.io/v1alpha1` CRDs.
- **Adversarial review + fixes applied** (report `../reports/code-reviewer-260802-1301-slice-8c-b-hpa-canary-rollout-red-team-review-report.md`; **NO Critical** — live-proven paths sound, shutdown wiring correct on all 13, payment/notification/analytics/delivery multi-replica-safe, RBAC least-privilege, no API-version mismatch):
  - **H1 (High)** — the polling **outbox relay** (order/payment/review/inventory) is NOT replica-safe: its `SKIP LOCKED` claim-lock releases at fetch-tx-commit BEFORE publish+markPublished, and its own doc prescribes "one relay per service". This slice's prod `minReplicas:2` runs ≥2 concurrent relays → the duplicate-publish rate becomes O(replicas) (functionally still at-least-once — consumers dedupe — but it silently violates the invariant). My plan's scale-safety analysis had covered delivery + saga-reaper but MISSED the relay. **Fixed**: a Postgres session-held advisory lock (`pg_try_advisory_lock`, shared `libs/shared/persistence` helper) serializes the whole drain across replicas — a contended replica cleanly skips the tick; single-replica behaviour unchanged; the relay stays generic via an optional `OutboxPort.runExclusively`.
  - **M1 (Medium)** — two HPA objects both targeted `Deployment/order` (base CPU HPA + the standalone custom-metric HPA) → latent flap once the custom metric activates. **Fixed**: folded the custom `Pods` metric into order's SINGLE base HPA (cpu + request-rate on one object — the production multi-metric pattern) and deleted the standalone; the observability component now ships only the metrics plumbing.
  - Low/documented: payment Temporal worker drain can exceed the ~25s effective grace but is Temporal-durable + idempotent (no loss); blue-green apply has a brief zero-endpoint window (demo-only); custom-metric documenting-not-fixing is the right call with both fix paths technically correct.
- **Brief**: Add the production rollout + scaling layer on top of 8c-A's manifests: **HPA** (CPU-based for the stateless services + a **custom-metric** HPA via **prometheus-adapter** reading 8b's metrics), a **progressive-delivery** story (**blue-green** via Service-selector switch + **canary** via Traefik weighted routing), and **graceful shutdown** fleet-wide (the 5 services still missing `enableShutdownHooks` + a `preStop` drain hook + `terminationGracePeriodSeconds` on every Deployment) so a rollout doesn't drop in-flight requests. Verified on the existing local **k3d** cluster (metrics-server + Traefik + CRDs already present).

## Key decisions (verify tool/image versions live)
- **CPU HPA on the stateless services** (`infra/k8s/base/<app>/hpa.yaml` or an overlay): `HorizontalPodAutoscaler` (autoscaling/v2) targeting each stateless Deployment on `cpu` averageUtilization (e.g. 70%), min 1 / max N. metrics-server is already in k3d (CPU metrics work — `kubectl top` confirmed). Apply to gateway/catalog/order/search/etc.; do NOT HPA the singleton-sensitive ones the same way (delivery WS is replica-safe via RedisIoAdapter so it CAN scale; order's saga-reaper is discovery-only so it's safe too — but keep min sensible). Resource `requests` already set in 8c-A (HPA needs them).
- **Custom-metric HPA via prometheus-adapter** (the real learning): deploy **prometheus-adapter** (`infra/k8s/observability` or a component) configured to expose a Prometheus metric (e.g. `http_server_request_duration_seconds_count` rate → RPS per pod, or a Kafka consumer-lag gauge) as a k8s custom metric, and an HPA that scales one representative service (e.g. `order` or `gateway`) on it (`type: Pods`/`Object`). This needs Prometheus reachable in-cluster — deploy a minimal in-cluster Prometheus (reuse 8b's config, scraping the in-cluster OTel Collector) OR point the adapter at a Prometheus Service. Demonstrate live on ONE service if RAM permits; otherwise ship the manifests + adapter rules validated (kubeconform) and document the wiring. This is where 8b's metrics feed autoscaling (the phase's "HPA scales on CPU + custom metrics" goal).
- **Blue-green via Service selector** (native, KISS): two Deployments (`<app>-blue` / `<app>-green` with a `version` label) behind one Service whose selector includes `version: blue|green`; cutover = patch the Service selector → instant, atomic switch; rollback = flip back. Documented runbook + a demo on gateway. No extra controller.
- **Canary via Traefik weighted routing** (CRDs present): a Traefik `TraefikService` (weighted) or `IngressRoute` splitting traffic e.g. 90% stable / 10% canary across two Services, dialed up as the canary proves healthy. Demonstrate a live 80/20 split on gateway (repeated curls show the ratio). Native k8s Ingress can't weight; Traefik CRDs (already in k3d) can.
- **Argo Rollouts / Flagger = documented production alternative, NOT implemented** (YAGNI + no mesh on k3d): the native Service-switch (blue-green) + Traefik-weighted (canary) approaches teach the mechanics without a heavy controller. A design note explains where Argo Rollouts (automated analysis + progressive steps + auto-rollback on metric regression) fits for a real cluster, wired off 8b's SLO metrics.
- **Graceful shutdown (fleet-wide)**: add `app.enableShutdownHooks()` + a `bootstrap().catch()` to the **5** services still missing them (gateway, catalog, auth, order, review — inventory done in 8c-A) so Nest runs `onModuleDestroy` (Kafka consumer disconnect, Temporal worker shutdown, TypeORM/Redis close) on SIGTERM. Add — DRY via a base Kustomize patch to all 13 Deployments — a `lifecycle.preStop` (a short `sleep` so the pod is pulled from Service endpoints BEFORE the process exits, avoiding the race where SIGTERM beats endpoint deregistration and in-flight requests 502) + a sane `terminationGracePeriodSeconds` (long enough for Kafka/HTTP drain). This is what makes a rolling update / canary promotion zero-downtime.
- **Which services scale**: stateless HTTP/gRPC (gateway, catalog, order, inventory, payment, search, config, review, analytics, media, notification) → HPA. delivery scales too (RedisIoAdapter). Keep min=1 in dev (RAM), min≥2 in prod overlay. auth is stateless (JWT verify) → scalable.

## Requirements
**Functional**: a CPU HPA scales a service up under load and back down (demonstrated live); a custom-metric HPA (prometheus-adapter) is defined + validated (demonstrated live if RAM allows); a canary splits traffic by weight (Traefik) and a blue-green cutover switches versions atomically (both demonstrated on gateway); every Deployment drains gracefully on SIGTERM (shutdown hooks + preStop + grace period). **Non-functional**: HPA uses the already-set resource requests; rollout strategies documented with a runbook; no dropped requests on a rolling update; Argo/Flagger documented as the prod alternative; all manifests kubeconform-clean; overlays DRY.

## Architecture / data flow
```
metrics-server ─cpu─▶ HPA(cpu 70%) ─scale─▶ Deployment replicas (stateless services)
Prometheus(in-cluster, 8b metrics) ─▶ prometheus-adapter ─custom metric (RPS/kafka-lag)─▶ HPA(Pods) ─▶ one service
Traefik IngressRoute/TraefikService ─weighted 90/10─▶ {stable Service, canary Service}   (canary)
Service selector version: blue|green ─patch─▶ atomic cutover                              (blue-green)
SIGTERM ─▶ preStop sleep (endpoint deregister) ─▶ Nest enableShutdownHooks (onModuleDestroy drain) ─▶ exit
```

## Related code files
- `infra/k8s/base/<app>/hpa.yaml` (CPU HPA per stateless service) + base kustomization entries; or an `overlays`/component grouping. `autoscaling/v2`.
- `infra/k8s/observability/` (or a component): `prometheus-adapter` Deployment/Service/ConfigMap (metric rules) + an in-cluster Prometheus (minimal, reuse 8b `infra/prometheus` config) + the custom-metric HPA for one service.
- `infra/k8s/rollout/` — blue-green (two Deployments + Service selector doc) + canary (Traefik `IngressRoute`/`TraefikService` weighted) example manifests for gateway; a `ROLLOUT.md`-style runbook note IN the plan (not a new top-level doc) or inline comments.
- `apps/{gateway,catalog,auth,order,review}/src/main.ts` — `enableShutdownHooks()` + `bootstrap().catch()` (mirror inventory's 8c-A pattern).
- `infra/k8s/base/kustomization.yaml` — extend the base patch (added in 8c-A for startupProbe) with `lifecycle.preStop` + `terminationGracePeriodSeconds` for all 13 Deployments.
- Verify: on k3d — CPU HPA scales gateway under load then back; Traefik weighted canary shows the split; blue-green Service-switch cuts over; a rolling update drains cleanly. kubeconform on all new manifests.

## Implementation steps
1. Graceful shutdown: add hooks+catch to the 5 services; base patch preStop + terminationGracePeriodSeconds (all 13). Confirm unit tests still green.
2. CPU HPA manifests for the stateless services (autoscaling/v2, cpu 70%, min/max). kubeconform.
3. prometheus-adapter + minimal in-cluster Prometheus + custom-metric HPA for one service (rules mapping a Prometheus metric → k8s custom metric).
4. Progressive delivery: blue-green (two Deployments + Service selector) + canary (Traefik weighted) example manifests for gateway + runbook notes.
5. **Verify on k3d**: CPU HPA scale up/down under load; canary weight split; blue-green cutover; graceful drain on rolling update. kubeconform all.
6. Update plan before push; PR.

## Todo
- [x] graceful shutdown: `enableShutdownHooks()`+`.catch()` on gateway/catalog/auth/order/review; base patch `preStop` + `terminationGracePeriodSeconds` (all 13)
- [x] CPU HPA (autoscaling/v2, cpu target, min/max) for the stateless services; requests already set; kubeconform-clean
- [x] prometheus-adapter + in-cluster Prometheus + a custom-metric HPA (RPS or Kafka-lag) on one representative service
- [x] blue-green (Service selector switch) + canary (Traefik weighted routing) example manifests for gateway + runbook
- [x] Argo Rollouts/Flagger documented as the production alternative (design note, not implemented)
- [x] k3d live: CPU HPA scaled gateway 1→4 + back; canary 90/10 split; blue-green atomic cutover; zero-drop rolling-update drain (600/600)
- [x] outbox relay made replica-safe (advisory lock — the scale-safety gap the review caught); custom-metric folded into order's single HPA
- [x] biome/cruiser/knip/tsc + kubeconform; plan updated before push

## Success criteria
- A CPU HPA scales a service up under synthetic load and back down when it subsides (shown live on k3d).
- A custom-metric HPA is defined via prometheus-adapter against an 8b metric and validated (live if RAM allows, else manifest+rules validated).
- A canary splits traffic by weight (Traefik) and a blue-green cutover switches versions atomically — both shown on gateway.
- Every Deployment drains on SIGTERM (shutdown hooks + preStop + grace) — a rolling update completes without dropped requests.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Custom-metric stack (Prometheus+adapter) too heavy for 16GB k3d | H×M | CPU HPA is the primary live demo; custom-metric on ONE service, minimal Prometheus; validate manifests if a full live run won't fit |
| HPA flaps (scale up/down thrash) | M×M | Sane `behavior` stabilization windows + a conservative target; min replicas ≥1 |
| preStop/grace too short → requests still dropped | M×M | preStop sleep ≥ readiness period; grace ≥ preStop + drain; test a rolling update with in-flight load |
| Traefik CRD API drift (hub.traefik.io vs traefik.io) | L×M | Use the CRD group present in the cluster (verify `kubectl get crd`); kubeconform with the right schema or skip-missing |
| Scaling a non-replica-safe singleton | L×H | Only scale verified-safe services (delivery=RedisIoAdapter, order-reaper=discovery-only); document per service |
| Shutdown hooks change boot/behaviour | L×M | Mirror inventory's proven 8c-A pattern; run unit tests; hooks only add onModuleDestroy handling |

## Security considerations
- No new secrets. prometheus-adapter + Prometheus internal-network only, dev-exposed. HPA/rollout are control-plane; RBAC least-privilege for the adapter (reads metrics only).
- Canary/blue-green don't change the auth surface — same gateway JWT verification on both versions.

## Next steps
8d: GitHub Actions CI/CD (build/push images to a registry, `nx affected` build/test/lint, Trivy/Hadolint/actionlint, deploy with a health-gated rollout invoking THIS slice's canary/blue-green, Renovate). NetworkPolicy + sealed-secrets + Argo Rollouts as prod hardening.

## Design note: Argo Rollouts / Flagger (documented, not implemented)
The native mechanics shipped here — Service-selector blue-green
(`infra/k8s/rollout/blue-green/`) and Traefik-weighted canary
(`infra/k8s/rollout/canary/`) — teach the underlying primitives with zero
extra controllers, matching this slice's YAGNI/no-mesh-on-k3d constraint.
A production cluster would instead run **Argo Rollouts** (a `Rollout` CRD
replacing `Deployment`, with `canary.steps` driving progressive traffic
shifts) or **Flagger** (a mesh/ingress-agnostic operator watching the same
kind of Traefik/Istio/Linkerd weighted routing this slice hand-rolls).
Both add what's manual here:
- **Automated analysis**: query the 8b Prometheus SLO metrics
  (`http_server_request_duration_seconds_count` error/latency ratios,
  `saga_outcome_total`) after each traffic-shift step and gate promotion on
  them — vs. this slice's manual "watch the split, decide, patch."
- **Auto-rollback**: revert the weight/selector automatically on a metric
  regression, instead of a human running the rollback command in the
  runbooks above.
- **Progressive steps as one declarative object**: `Rollout.spec.strategy.canary.steps`
  (or Flagger's `Canary.spec.analysis`) encodes the 90/10 → 70/30 → 50/50 →
  100/0 ramp this slice's comment tells a human to hand-edit.
Not adopted now because it's a new controller + CRDs on a single-node k3d
learning cluster for a mechanic this slice's manifests already demonstrate;
revisit alongside 8d's CI/CD once a real multi-node target exists to
justify the operational overhead.

## Verification results
- `pnpm nx run-many -t test -p gateway catalog auth order review` — pass.
- `npx tsc --noEmit -p apps/{gateway,catalog,auth,order,review}/tsconfig.app.json` — pass, no errors on the 5 touched `main.ts`.
- `pnpm biome check` (touched dirs) — pass. `pnpm run cruiser` — pass. `pnpm run knip` — pass.
- `kubectl kustomize infra/k8s/overlays/{dev,prod}` render clean; `kubeconform -strict -ignore-missing-schemas -summary` — 0 invalid (71 resources dev, 64 prod, includes the 13 new HPAs).
- `kubectl kustomize infra/k8s/observability` renders 19 resources across 3 namespaces (observability/food-delivery/kube-system) correctly, unaffected by the aggregator's lack of a top-level `namespace:` field; kubeconform clean; `kubectl apply --dry-run=client -k` clean.
- `kubectl kustomize infra/k8s/rollout/{blue-green,canary}` render clean; kubeconform clean (Traefik CRDs skipped, no schema in kubeconform's catalog — expected); `kubectl apply --dry-run=server -k infra/k8s/rollout/canary` validated against the LIVE cluster's real `traefik.io/v1alpha1` CRD schema — clean.
- Traefik CRD apiVersion confirmed live: `kubectl get crd | grep traefik.io` shows `ingressroutes.traefik.io` and `traefikservices.traefik.io` both at `v1alpha1` — matches what `canary/ingressroute.yaml` and `canary/traefik-service.yaml` target.
- prometheus-adapter pinned to `registry.k8s.io/prometheus-adapter/prometheus-adapter:v0.12.0` (latest GitHub release at implementation time). otel-collector reuses the compose profile's pinned `otel/opentelemetry-collector-contrib:0.157.0`; Prometheus reuses `prom/prometheus:v3.13.2`.
- NOT run here (orchestrator's live k3d gates, per the task): CPU HPA scale up/down under synthetic load, custom-metric HPA actually scaling `order` off live traffic, canary weight-split ratio observed via repeated curls, blue-green cutover, and a rolling-update drain test under in-flight load.
