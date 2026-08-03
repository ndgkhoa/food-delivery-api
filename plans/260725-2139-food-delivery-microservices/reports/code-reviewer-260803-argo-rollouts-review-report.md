# Code Review — Argo Rollouts progressive-delivery demos (feat/argo-rollouts)

Reviewed: uncommitted Argo Rollouts conversion under `infra/k8s/argo-rollouts/` and
`infra/k8s/rollout/{canary,blue-green}/`. Demo/portfolio infra add-on — findings
weighted by real breakage over polish.

## Scope
- Controller install: `infra/k8s/argo-rollouts/{kustomization,namespace,README}.yaml`
- Canary: `rollout.yaml`, `analysis-template.yaml`, `service-{stable,canary}.yaml`, `traefik-service.yaml`, `ingressroute.yaml`, `kustomization.yaml`, `README.md`
- Blue-green: `rollout.yaml`, `service.yaml`, `service-preview.yaml`, `kustomization.yaml`, `README.md`
- Cross-checked: `infra/k8s/base/gateway/configmap.yaml`, `infra/k8s/observability/**`, `infra/prometheus/alert-rules.yml`, `libs/shared/observability/src/register.ts`, `apps/gateway/src/instrumentation.ts`

## Overall Assessment
Structurally sound. Rollout CRDs, Traefik trafficRouting, blue-green services, kustomize
wiring, and pod-spec hardening are all correct. The single real problem is the **canary
AnalysisTemplate**: the PromQL is well-formed and label-correct, but the metric-data
pipeline it depends on is not wired for the standalone demo path, so the analysis step
will error/mis-fire and auto-abort a *healthy* canary — defeating the demo's purpose. This
is exactly the risk the plan flagged (backlog-d4 line 48) and it is not yet closed.

---

## Critical

### C1 — Analysis step auto-aborts a healthy canary: gateway metrics never reach the queried Prometheus
`infra/k8s/rollout/canary/analysis-template.yaml:23-27` + `infra/k8s/base/gateway/configmap.yaml:13` + `infra/k8s/rollout/canary/README.md:8-11`

The query itself is correct: gateway calls `registerTracing('gateway')`
(`apps/gateway/src/instrumentation.ts:8`) → `service.name=gateway` → OTel Prometheus
exporter surfaces `job="gateway"`; auto-instrumentation emits
`http_server_request_duration_seconds_count` with `http_response_status_code`
(`libs/shared/observability/src/register.ts:44`). Metric name, `job` label, and status
label all match `infra/prometheus/alert-rules.yml`. **But the data never arrives:**

1. The Rollout pod template mounts `envFrom: gateway-config` (`rollout.yaml:41-43`). The
   base `gateway-config` sets `OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector.food-delivery:4318`
   (`base/gateway/configmap.yaml:13`). There is **no otel-collector in the `food-delivery`
   namespace** — the collector lives only in `observability`
   (`infra/k8s/observability/otel-collector/`; prod overlay corrects the endpoint to
   `otel-collector.observability:4318`, dev overlay disables telemetry). So in the
   standalone demo (base config, no overlay), gateway metric export fails silently.
2. The AnalysisTemplate provider address is `http://prometheus.observability:9090`
   (`analysis-template.yaml:23`), but the canary runbook (`canary/README.md:8-11`) never
   tells the operator to deploy `infra/k8s/observability` first. If it isn't up, the
   provider call fails DNS.

Net: with no gateway series in Prometheus (or Prometheus unreachable), the ratio query
returns empty/error every window → the `analysis` step at `rollout.yaml:100-102` cannot
satisfy `result[0] >= 0.95` → the AnalysisRun ends in Error/Failed → **the Rollout aborts
a perfectly healthy canary at step 3.** The demo's headline feature (analysis-gated
auto-rollback) fires backwards.

Fix (any one path, ideally all three):
- Point the demo gateway's OTLP at the real collector: patch `gateway-config`'s
  `OTEL_EXPORTER_OTLP_ENDPOINT` to `http://otel-collector.observability:4318` for this
  demo (or run a collector in `food-delivery`).
- Make `canary/README.md` prerequisite explicit: `kubectl apply -k infra/k8s/observability`
  before the canary, and confirm `job="gateway"` series exist in Prometheus
  (`otel-collector:8889/metrics`) before triggering a rollout.
- See H1 for making the analysis itself no-data-tolerant so a wiring gap degrades to "skip"
  rather than "abort".

---

## High

### H1 — Analysis mis-fires on sparse traffic; `failureLimit: 1` aborts on a single transient blip
`infra/k8s/rollout/canary/analysis-template.yaml:16-19`

Even with C1's pipeline fixed, the analysis is fragile against the demo's own traffic
shape:
- The demo generates traffic by a one-shot `for i in seq 1..20; curl` loop
  (`ingressroute.yaml:12-14`). With `rate(...[2m])` over 3×30s windows, most windows see
  **zero canary traffic** → denominator `sum(rate(total))` is 0. Prometheus returns either
  an empty vector (no series) or a sample with value `NaN` (0/0). `NaN >= 0.95` is `false`
  → measurement **Failed**; empty → measurement **Error**.
- With `failureLimit: 1`, a **single** bad/no-data window aborts the run. So a brief real
  blip mid-rollout ALSO kills a healthy deploy — the template does *not* ride out a
  transient dip (directly answering the review question: it is too strict, not too loose).

Fix:
- Generate **continuous** load during the analysis window (k6/`hey`/`infra/load-test`), not
  a 20-request burst, so the ratio has a real denominator.
- Guard against no-data so a gap is inconclusive, not a hard abort — e.g. gate on request
  volume and treat empty as pass:
  `successCondition: len(result) == 0 || result[0] >= 0.95` (or add a separate
  `failureCondition: len(result) > 0 && result[0] < 0.95`).
- Loosen `failureLimit` to `2` so one transient sub-95% window doesn't abort a good rollout,
  while a sustained 5xx storm still trips ≥2 windows and aborts. Consider widening the rate
  window or lengthening `interval`.

This is the plan's own open risk (backlog-d4 line 48: "a query error should be tuned, not
left to auto-abort") — not yet closed.

---

## Medium

### M1 — Canary Rollout selector overlaps the still-running base gateway Deployment; README omits the scale-to-0 note
`infra/k8s/rollout/canary/rollout.yaml:18-20` + `infra/k8s/rollout/canary/README.md`

`spec.selector.matchLabels: {app.kubernetes.io/name: gateway}` also matches the pods of the
base `gateway` Deployment (`base/gateway/deployment.yaml`), which is not scaled down by this
demo. Consequences: (a) before the controller injects `rollouts-pod-template-hash`,
`gateway-stable`/`gateway-canary` Services transiently select the base Deployment's pods too;
(b) the Rollout may log adoption warnings / miscount available replicas against foreign pods.
The blue-green README already instructs "scale the base gateway Deployment to 0"
(`blue-green/README.md:6-8`) but the **canary README does not**.

Fix: add the same "scale `infra/k8s/base/gateway` to 0 first" instruction to
`canary/README.md`.

### M2 — Controller install via client-side `kubectl apply -k` may exceed the CRD annotation limit
`infra/k8s/argo-rollouts/kustomization.yaml:15` + `infra/k8s/argo-rollouts/README.md:8`

The kustomization pulls the full upstream `install.yaml` (large CRDs) as a remote resource;
`kubectl apply -k` uses client-side apply, which writes the
`kubectl.kubernetes.io/last-applied-configuration` annotation. Large CRDs can breach the
262144-byte annotation limit → `metadata.annotations: Too long` and the install fails on
first apply. Version-dependent, so flagged Medium not Critical.

Fix: document/use server-side apply — `kubectl apply -k infra/k8s/argo-rollouts
--server-side --force-conflicts` — in `argo-rollouts/README.md`. (Unresolved: confirm with
`kubectl apply -k infra/k8s/argo-rollouts --dry-run=server` against the target cluster.)

---

## Low

### L1 — Canary README overstates the abort threshold
`infra/k8s/rollout/canary/README.md:16-17` describes "aborts on <95% ... over 3 x 30s
windows", implying 3 consecutive bad windows are needed. With `failureLimit: 1` it aborts on
the **first** sub-95% (or no-data) window; `count: 3` is the max measurements to *pass*, not
a consecutive-failure requirement. Reword once H1's tuning is settled.

### L2 — Redundant final `setWeight: 100`
`infra/k8s/rollout/canary/rollout.yaml:106` — harmless; the Rollout fully promotes after the
last step regardless. Leave as-is (explicit is fine for a demo).

---

## Verified Correct (no action)
- **Canary strategy shapes**: `canaryService: gateway-canary` / `stableService: gateway-stable`
  / `trafficRouting.traefik.weightedTraefikServiceName: gateway-weighted`
  (`rollout.yaml:91-95`) all reference real objects in-dir; steps
  (setWeight/pause/analysis) are valid; `analysis.templates.templateName:
  gateway-success-rate` matches the AnalysisTemplate metadata name. Traefik is a native
  trafficRouting provider in v1.9.1 — no plugin needed. The weighted TraefikService lists
  `gateway-stable` (100) / `gateway-canary` (0) by name+port; Argo owns the weights live.
- **Blue-green**: `activeService: gateway` and `previewService: gateway-preview`
  (`blue-green/rollout.yaml:90-91`) both exist (`service.yaml`, `service-preview.yaml`);
  `autoPromotionEnabled: false` correctly models the manual-promotion demo; no
  duplicate-selector or missing-preview issue.
- **Service-selector change is correct Argo behavior**: dropping `track:`/`version:` and
  keeping only `app.kubernetes.io/name: gateway` is right — Argo injects
  `rollouts-pod-template-hash` into the canary/stable (and active/preview) Service selectors
  at runtime, steering them at the correct ReplicaSet. The only caveat is the transient
  overlap in M1.
- **PromQL correctness**: metric `http_server_request_duration_seconds_count`, `job="gateway"`,
  and `http_response_status_code!~"5.."` all match what the OTel auto-instrumentation emits
  and what `alert-rules.yml` keys off. The query is well-formed; the problem (C1/H1) is data
  availability, not the query text.
- **Pod-spec fidelity**: the Rollout pod template is byte-for-byte equivalent to the deleted
  `deployment-canary.yaml` hardening — `runAsNonRoot`, `runAsUser/Group 1000`,
  `readOnlyRootFilesystem`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`,
  startup/liveness/readiness probes, `preStop sleep 5`, `terminationGracePeriodSeconds: 30`,
  `envFrom gateway-config`, image `food-delivery/gateway:dev`, tmp emptyDir. No weakening or
  drift. Only intended change is removing the `track:`/`version:` pod label.
- **kustomize wiring**: both dir kustomizations list exactly the present resources; the four
  old Deployments are removed from the apply set with no dangling references; controller
  kustomization correctly omits a `namespace:` transformer (upstream install.yaml hardcodes
  `argo-rollouts`) and adds `namespace.yaml` (install.yaml does not create the namespace).
  The raw-URL form is the right choice (git-ref form fails kustomize's directory loader).

---

## Recommended Actions (priority order)
1. **C1** — wire the demo's metric pipeline: patch gateway `OTEL_EXPORTER_OTLP_ENDPOINT` to
   `otel-collector.observability:4318` and make `infra/k8s/observability` a documented
   prerequisite in `canary/README.md`. Blocks the canary demo from working at all.
2. **H1** — make the analysis no-data-tolerant (`len(result)==0 || result[0] >= 0.95`),
   raise `failureLimit` to 2, and drive continuous load during the window. Prevents
   healthy-canary false aborts.
3. **M1** — add the "scale base gateway to 0" note to `canary/README.md`.
4. **M2** — document `--server-side` for the controller install.
5. **L1/L2** — minor doc wording.

## Metrics
- Files reviewed: 16 (12 changed/added manifests + 4 cross-referenced). No code (YAML/infra only).
- Type/test coverage: n/a (infra manifests).
- Blocking issues: 1 Critical, 1 High.

## Unresolved Questions
1. Is the standalone canary demo *intended* to run with `infra/k8s/observability` deployed and
   continuous load, or as a pure "watch the weights step" demo? If the latter, the analysis
   step should be dropped or made no-data-tolerant rather than left able to auto-abort a good
   rollout.
2. Does the target k3d cluster hit the CRD annotation limit on client-side apply of the v1.9.1
   install.yaml? Confirm with `--dry-run=server` before relying on `kubectl apply -k`.
3. Was pointing base `gateway-config` OTLP at `otel-collector.food-delivery` (vs
   `.observability`) a deliberate base default fixed only by overlays, or a latent bug? It
   directly breaks the analysis demo path.
