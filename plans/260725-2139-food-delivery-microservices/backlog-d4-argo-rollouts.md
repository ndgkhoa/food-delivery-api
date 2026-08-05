# Backlog D4 — Argo Rollouts (automated progressive delivery)

Context: [plan.md](./plan.md) · [phase-08c-b-hpa-canary-rollout.md](./phase-08c-b-hpa-canary-rollout.md)

## Overview
- **Priority**: portfolio-plus — **last** D-item; completes the whole B/C/D backlog.
- **Status**: ✅ Verified live (real k3d + Argo controller) — branch `feat/argo-rollouts`. Awaiting review/merge.
  - **Namespace bug caught by live apply (kustomize built clean but applied wrong)**: the upstream `install.yaml` does NOT stamp a namespace on its namespaced objects (it expects `kubectl apply -n argo-rollouts`), so the controller Deployment/ConfigMap/Secret/SA landed in `default`. **Fixed**: added `namespace: argo-rollouts` to `infra/k8s/argo-rollouts/kustomization.yaml` (transformer only touches namespaced kinds; CRDs/ClusterRoles stay cluster-scoped). Re-applied → controller **1/1 in argo-rollouts**.
  - **Canary proven end-to-end**: applied the canary `Rollout` (base gateway scaled to 0 during the test to avoid the selector overlap — see review). The controller adopted it → the initial revision went Healthy (2/2, its own managed ReplicaSet). Then a template change (new revision) drove the canary: phase Healthy → Progressing → **Paused at step 1**, and the controller **automatically set the Traefik weight to stable=90 / canary=10** (the automation that replaces 8c-B's hand-edited weights). The `gateway-success-rate` Prometheus AnalysisTemplate is wired into the steps. Cleaned up + restored base gateway afterward; controller left installed.
  - **Blue-green** verified via `kubectl kustomize` + kubeconform (`-ignore-missing-schemas`) — same `Rollout` CRD pattern, `blueGreen` strategy (activeService/previewService, manual promotion); not separately live-applied (would collide with the same-named canary/base gateway).
  - **CD fully green (fold-in)**: the develop CD run is 13/13 image-scan + 13/13 build+sign+scan — the runtime-image CVE thread (distroless + severity gate + 2 justified ignores) is complete.
  - **Adversarial review + fixes** (report `../reports/code-reviewer-260803-argo-rollouts-review-report.md`; structurally sound — CRDs, Traefik routing, blue-green services, the selector drop, and byte-identical hardened pod spec all verified correct):
    - **C1 (Critical) + H1**: the AnalysisTemplate would auto-abort a HEALTHY canary — with no metrics pipeline / sparse traffic the query returns no rows, and `failureLimit: 1` aborted on a single window. **Fixed**: `successCondition: len(result) == 0 || result[0] >= 0.95` (no-data is a PASS, so a metric-less demo steps through the pauses; the ratio only gates when real data exists) + `failureLimit: 2` (rides out one transient window). README documents the analysis prereqs (observability up + OTLP reaching Prometheus + live load).
    - **M1**: the Rollout selector overlaps the base `gateway` Deployment → canary README now documents scaling the base to 0 first (mirrors the blue-green README), matching how the live test was run.
    - **M2**: controller install README recommends `kubectl apply -k … --server-side` (the large CRDs can exceed the client-side annotation limit).
    - **Low**: dropped the redundant trailing `setWeight: 100` (the controller auto-promotes after the last step); corrected the README abort-threshold wording.

## Todo
- [x] `argo-rollouts/` controller install (pinned v1.9.1) + namespace (`namespace: argo-rollouts` transformer — the fix) + README (`--server-side`)
- [x] canary `Rollout` (Traefik trafficRouting, weighted steps) + Prometheus AnalysisTemplate (no-data guard); services/traefik/ingressroute kept
- [x] blue-green `Rollout` (activeService/previewService, manual promotion); services kept
- [x] kustomizations + both READMEs updated
- [x] verified live: controller installed in k3d + canary progresses/pauses + auto-drives Traefik weight (90/10); kustomize + kubeconform clean
- [x] folded the CD-green status; plan updated before push
- **Brief**: 8c-B demonstrated progressive delivery MANUALLY — two Deployments (`gateway-stable` + `gateway-canary`) with a hand-edited Traefik `TraefikService` weight for canary, and blue/green via a Service selector switch. Replace that with **Argo Rollouts**: install the controller and convert both demos to a single `Rollout` CRD each, so the canary weight steps + blue/green cutover are driven automatically (with Prometheus-analysis-gated auto-rollback), not by hand-editing YAML.
- **Note (fold-in)**: the runtime-image CVE thread is DONE — the develop CD run is fully green (13/13 image-scan + 13/13 build+sign+scan); recorded here since that work had no standing branch.

## Facts (scouted)
- Argo Rollouts latest **v1.9.1** (pin the controller install to it). The k3d cluster already has the Traefik CRDs (`traefikservices.traefik.io`, `ingressroutes.traefik.io`) the canary traffic-routing needs. `kubectl argo rollouts` plugin is NOT installed (verify via `kubectl get rollout` + the controller, or install the plugin).
- Existing manual manifests: `infra/k8s/rollout/canary/` (stable+canary Deployments, 2 Services, `gateway-weighted` TraefikService 90/10, IngressRoute on `canary.gateway.localhost`) and `infra/k8s/rollout/blue-green/` (blue+green Deployments, Service selector switch). Gateway pod spec: http:3000, `gateway-config` configMap, the full securityContext + probes + preStop.

## Design
- **Controller** — new `infra/k8s/argo-rollouts/`: `namespace.yaml` (`argo-rollouts`) + a `kustomization.yaml` that references the PINNED upstream install as a remote base (`https://github.com/argoproj/argo-rollouts/manifests/install.yaml?ref=v1.9.1`) — or vendors it — plus a README noting the plugin install. Kept separate from base/overlays (a cluster add-on, like the observability stack).
- **Canary → `Rollout`** (`infra/k8s/rollout/canary/`): replace the two Deployments with ONE `argoproj.io/v1alpha1/Rollout` named `gateway`, reusing the gateway pod template verbatim (image/probes/securityContext/preStop). `strategy.canary`:
  - `canaryService: gateway-canary`, `stableService: gateway-stable` (keep both Services); `trafficRouting.traefik.weightedTraefikServiceName: gateway-weighted` (Argo now OWNS the TraefikService weights — drop the "hand-edit the weight" comment).
  - `steps`: `setWeight 10` → `pause {duration: 30s}` → an `analysis` (AnalysisTemplate, below) → `setWeight 50` → `pause` → `setWeight 100`. Auto-rollback if analysis fails.
  - Keep the `TraefikService` (weights now controller-managed; start 100/0) + the IngressRoute.
- **AnalysisTemplate** (`infra/k8s/rollout/canary/analysis-template.yaml`): a Prometheus `success-rate` metric (query the 8b `http_server_request_duration_seconds_count` for the canary `job`, ratio of non-5xx) with a `successCondition` + `failureLimit` — ties the rollout to the 8b SLO metrics so a bad canary auto-aborts. Points at the in-cluster Prometheus (`http://prometheus.observability:9090` — confirm the address).
- **Blue-green → `Rollout`** (`infra/k8s/rollout/blue-green/`): replace blue+green Deployments with ONE `Rollout`, `strategy.blueGreen`: `activeService` + `previewService`, `autoPromotionEnabled: false` (manual `kubectl argo rollouts promote`), `scaleDownDelaySeconds`. Keep the two Services.
- **READMEs**: update both demo READMEs — promotion is now `kubectl argo rollouts get rollout gateway --watch` + `... promote`, not hand-edited weights.

## Related files
- NEW `infra/k8s/argo-rollouts/{namespace,kustomization}.yaml` + README.
- `infra/k8s/rollout/canary/` — replace `deployment-stable.yaml`+`deployment-canary.yaml` with `rollout.yaml`; add `analysis-template.yaml`; keep services/traefik/ingressroute; update kustomization + README + traefik-service comment.
- `infra/k8s/rollout/blue-green/` — replace `deployment-blue.yaml`+`deployment-green.yaml` with `rollout.yaml`; keep services; update kustomization + README.

## Success criteria
- `kubectl kustomize` builds `infra/k8s/argo-rollouts` + both rollout dirs; the manifests validate.
- On a live k3d with the controller installed: applying the canary `Rollout` is picked up by the controller; `kubectl get rollout gateway` shows the canary strategy + steps + a healthy status (paused at a step or progressing). The blue-green `Rollout` shows active/preview.
- The Prometheus AnalysisTemplate references a real 8b metric + the in-cluster Prometheus.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Argo controller not installed → Rollout objects inert | M×M | Provide the pinned controller install; live-verify by installing it in k3d before applying the Rollout |
| Traefik trafficRouting integration misconfigured | M×M | Reuse the existing `gateway-weighted` TraefikService (Argo supports Traefik traffic routing); verify the controller manages its weights live |
| AnalysisTemplate query wrong / Prometheus addr wrong → analysis errors abort a good rollout | M×M | Point at the real 8b metric + confirm the Prometheus service DNS; a query error should be tuned, not left to auto-abort — verify the template resolves |
| Rollout pod template drifts from the base Deployment | L×M | Copy the gateway template verbatim (image/probes/securityContext/preStop) from the existing canary Deployment |
| Remote kustomize base needs network at build | L×L | Pin the ref; document; or vendor install.yaml if offline builds are required |

## Security considerations
- Reuses the hardened gateway pod spec (nonRoot, readOnlyRootFilesystem, dropped caps, seccomp). The controller runs in its own `argo-rollouts` namespace. No new exposed surface — the canary rides the existing Traefik entrypoint on a demo Host.

## Next steps
Backlog complete after this. Then cut **v1.0.0** (merge develop→main + tag + GitHub Release) per the user's decision.
