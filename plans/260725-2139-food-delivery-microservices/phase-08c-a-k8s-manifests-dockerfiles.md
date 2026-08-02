# Slice 8c-A — App Dockerfiles + K8s manifests + Kustomize overlays

Context: [phase-08.md](./phase-08-ops-observability.md) · [phase-08b-metrics-logs-slo.md](./phase-08b-metrics-logs-slo.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2 — first 8c sub-slice (after 8b metrics/logs #30). 8c-B (HPA + canary) builds on this; 8d CI/CD follows.
- **Status**: ✅ Verified live (k3d) + adversarially reviewed (1 Critical + 1 High + fixes applied) — branch `feat/k8s-manifests-dockerfiles`. Single PR. One parameterized multi-stage Dockerfile (`infra/docker/Dockerfile`, `ARG APP`) builds any of the 13 apps; a shared `libs/shared/health` module gives the 12 non-gateway services a `/api/v1/health` 200; per-service K8s manifests (Deployment/Service/ConfigMap + placeholder Secret) + gateway Ingress under `infra/k8s/base`; Kustomize `dev`/`prod` overlays + an `infra-dev` (postgres+redis) component for local runs.
  - **Live evidence (k3d, k3s v1.35.5)**: the **gateway** image builds non-root, deploys via the actual dev overlay, pod reaches **1/1 Ready** through real `/api/v1/health` liveness+readiness+startup probes, and the **Traefik Ingress** routes external traffic → `{"status":"ok"}` HTTP 200 (its logs now carry `trace_id` as CONTAINER logs — completing the 8b log↔trace pivot). The **catalog** image builds, is env-complete (zod validation passes), and **connects to Postgres** — blocked only on Kafka (documented: infra-dev is postgres+redis; the full 13-service graph is a cloud concern). `kubectl kustomize` dev+prod both render; **kubeconform** dev 58/58 + prod 51/51 valid; 349+ unit tests, tsc/biome/dependency-cruiser (904 modules, 0 violations)/knip clean.
  - **Bugs found + fixed during live k3d verification** (offline gates were all green — these only surfaced on a real cluster):
    - **Dockerfile: `pg` missing (all DB services)** — TypeORM loads its driver via a runtime `require('pg')`, invisible to webpack's `generatePackageJson`, so the pruned runtime image lacked `pg` and every DB service crashed with `DriverPackageNotInstalledError`. Fixed: the runtime stage explicitly `npm install`s `pg@8.22.0` (pinned to root `^8.22.0`). (Review confirmed this is the ONLY such blindspot across all 13 — nx captures regular deps + regular peers, skips only *optional* peers, and `pg` was the sole optional-peer dynamic-require; `@temporalio/core-bridge` + all native modules are regular deps → captured.)
    - **infra-dev postgres CrashLoopBackOff** — `capabilities: drop:[ALL]` stripped the CHOWN/SETUID the postgres entrypoint needs, and no PGDATA override (postgres:18 defaults PGDATA off the mounted volume). Fixed: pod `fsGroup:999` + `PGDATA=/var/lib/postgresql/data/pgdata` + removed the cap-drop (dev-only infra).
    - (Agent's own build fixes: builder installs `git` for the root `prepare`/`lefthook install` + `git init`s a throwaway repo.)
- **Adversarial review + fixes applied** (report `reports/code-reviewer-260802-1248-slice-8c-a-k8s-manifests-dockerfiles-red-team-review-report.md`; the generatePackageJson audit came back CLEAN beyond `pg`, bootstrap conversions verified correct, securityContext exemplary + 100% consistent):
  - **C1 (Critical)** — the **dev overlay** patched `NODE_ENV=development`, which makes the logger require `pino-pretty` (a devDependency ABSENT from the prod image) → ALL 13 services CrashLoop under `kubectl apply -k overlays/dev`. It rendered green in CI (kubeconform) but was never runtime-applied (live-verify used the base per-app kustomizations, which are `NODE_ENV=production`). **Confirmed empirically** (prod image + `NODE_ENV=development` → `unable to determine transport target for "pino-pretty"`; pino-pretty absent from the image) and **fixed** (dev overlay keeps the base `production`; pretty logs are useless for `kubectl logs` anyway) — **re-verified live**: gateway now stays 1/1 Ready under the actual dev overlay.
  - **H1 (High)** — DB/Kafka/Redis/Temporal connect during Nest bootstrap, BEFORE the HTTP health port binds, so on a cold start with a slow dependency BOTH liveness and readiness fail identically and liveness restarts the pod before the dependency appears (thundering restart). **Fixed**: a `startupProbe` (30×10s = 5-min window) added once via a base Kustomize patch to all 13 Deployments — k8s suspends liveness/readiness until it passes, so slow boots don't get killed.
  - **M2** — the converted `inventory` bootstrap lacked `enableShutdownHooks()`+`.catch()` (inconsistent with notification). **Fixed** for inventory; the broader fleet-wide gap (6 services still lack graceful-shutdown hooks) deferred to **8c-B** where rollout/drain behaviour is the focus.
  - **M3 (verified NOT a real risk)** — prod `replicas:2` was flagged unsafe for the order saga-reaper + a WS service. Traced to source: the reaper is **discovery-only** (it does NOT compensate, just surfaces stranded sagas) with atomic-CAS transitions, partition-maintenance is idempotent, and delivery's WS uses `RedisIoAdapter` (multi-replica-safe). So `replicas:2` is safe (worst case: duplicate reaper *discovery logs*, cosmetic) — no change, documented.
  - **M4 (de-risked)** — payment's Temporal worker under `readOnlyRootFilesystem`: smoke-ran the payment image `--read-only --tmpfs /tmp` → loaded @temporalio native + instrumentation + NestFactory with **no read-only-fs error**; the deployment already mounts a `/tmp` emptyDir. Full worker-bundling verification needs the cluster's Temporal+DB (cloud). **Low fix applied**: the Dockerfile now strips `*.spec.*` from the copied `workflows/` (no test code in the prod image).
  - Deferred/documented: M1 (pg pin can drift from the lockfile — commented maintenance point); fleet-wide shutdown hooks (8c-B); placeholder Secrets in git (prod uses an external secret manager, 8d).
- **Brief**: Make the 13 services **deployable to Kubernetes**. A single parameterized multi-stage **Dockerfile** builds any app's webpack bundle into a slim runtime image; per-service **K8s manifests** (Deployment + Service + ConfigMap; Secrets referenced) plus a **gateway Ingress**; a **Kustomize** base + `dev`/`prod` overlays. Verified by actually deploying a representative subset (gateway + catalog + order + minimal infra) to a local **k3d** cluster and hitting it. HPA + canary/blue-green are 8c-B. This is also where the 8b log↔trace pivot completes end-to-end (app logs become container logs Alloy can scrape).

## Key decisions (verify tool/image versions live)
- **ONE parameterized Dockerfile** (`infra/docker/Dockerfile`, `ARG APP`), not 13 — DRY. Multi-stage: (1) **builder** on `node:24.14-slim` (matches `engines.node`): `corepack` → `pnpm@10.32.1` install (whole workspace, cached), `pnpm nx build <APP> --configuration=production` → `dist/apps/<APP>` (webpack bundle + `generatePackageJson`'d package.json). (2) **runtime** on `node:24.14-slim`: copy `dist/apps/<APP>`, `pnpm install --prod` from the generated package.json, copy any runtime assets (the `.proto` files webpack copies to `dist/apps/<APP>/proto`, and — for `payment` only — the Temporal `workflows/` source the worker bundles via `TEMPORAL_WORKFLOWS_PATH`). Non-root user, `NODE_ENV=production`, `CMD ["node","main.js"]`. `.dockerignore` (node_modules, dist, .git, plans). Keep the image lean; a distroless runtime is a later optimization (KISS).
- **Representative-subset verification, not all-13-in-k3d** (16GB): build the `catalog` image (HTTP + gRPC + Postgres, NO Temporal — simplest real service) + `gateway`; deploy them + minimal infra (a single-node `postgres` + `redis`) to k3d; prove: image builds, pod runs (readiness green), Service resolves, `GET /health`/a catalog read works through the gateway Ingress. Payment/Temporal/Kafka full-graph deploy is a cloud concern (documented). All 13 manifests still SHIP (the deliverable is the full set); only the local RUN is a subset.
- **Manifests per service** (`infra/k8s/base/<app>/`): `Deployment` (1 replica base, `resources.requests/limits`, liveness/readiness probes on the health endpoint, `envFrom` ConfigMap + Secret, `securityContext` non-root/read-only-fs where feasible, the OTLP endpoint pointing at the in-cluster collector), `Service` (ClusterIP; gateway also gets the Ingress). A shared `ConfigMap` per app for non-secret env (ports, service URLs, `OTEL_EXPORTER_OTLP_ENDPOINT`, feature flags) and a `Secret` (DB creds, JWT/Keycloak, MinIO, etc.) — Secrets as manifests with **placeholder/dev values only** (never real creds; prod via a secret manager, documented). gRPC services expose their gRPC port on the Service too.
- **Kustomize** (`infra/k8s/`): `base/` (all app + shared resources, a namespace `food-delivery`), `overlays/dev/` (1 replica, `imagePullPolicy: IfNotPresent`, local image tags, the minimal-infra component, lower resource requests, `TELEMETRY_ENABLED` per env), `overlays/prod/` (replicas ≥2 for stateless apps, real resource limits, prod image registry refs, no in-cluster infra — points at managed Postgres/Kafka/etc. via Secrets). Overlays patch replicas/resources/image, not duplicate manifests. Validate every overlay renders (`kubectl kustomize`) + schema-checks (`kubeconform`).
- **In-cluster infra is DEV-overlay-only**: a small `infra/k8s/infra-dev/` component (single-replica `postgres`, `redis`, — and only if a subset needs them, `kafka`) as plain Deployments/StatefulSets + Services, used ONLY by the dev overlay for local k3d runs. Prod overlay assumes EXTERNAL managed infra (the app Secrets point at real hosts). This keeps prod manifests clean and lets local k3d run a subset. Document the split.
- **Health/probes**: every app needs a liveness + readiness endpoint. If a shared `GET /health` doesn't already exist, add a tiny terminus-style health check (or reuse an existing one) — verify what's there first; probes must hit a real 200. Readiness gates on DB/broker where the app can't serve without it (keep simple: a basic liveness + a readiness that returns 200 once Nest is up).
- **Image registry**: dev uses locally-built images imported into k3d (`k3d image import`); prod overlay references a registry path (`ghcr.io/ndgkhoa/<app>:<tag>` placeholder) wired for real in 8d CI/CD. No registry push in this slice.
- **Nginx/gateway**: the K8s **Ingress** mirrors the compose Nginx L7 routing (path-prefix → service). Nginx itself isn't containerized into k8s here — the Ingress controller (k3d ships Traefik) plays that role. Document the mapping.

## Requirements
**Functional**: a single Dockerfile builds any of the 13 apps into a runnable image; `kubectl kustomize overlays/dev` and `overlays/prod` both render valid manifests; deploying the dev overlay's representative subset to k3d yields running pods with green readiness, resolvable Services, and a working request through the gateway Ingress. **Non-functional**: images non-root + lean; no real secrets in manifests; overlays DRY (patches, not copies); every manifest passes `kubeconform`; dev overlay runs on k3d within 16GB (subset + 1 replica).

## Architecture / data flow
```
infra/docker/Dockerfile (ARG APP) ─build─▶ <app> image ─k3d image import─▶ k3d cluster
infra/k8s/base/<app>/{deployment,service,configmap}.yaml + secret (placeholder)
   overlays/dev  → 1 replica, local images, infra-dev component (postgres/redis) ─▶ k3d
   overlays/prod → ≥2 replicas, registry images, external infra via Secrets
Ingress (Traefik on k3d) ─path prefix─▶ gateway Service ─▶ gateway pod ─▶ (gRPC/HTTP) services
Deployment probes: liveness + readiness → GET /health (200)
OTEL_EXPORTER_OTLP_ENDPOINT → in-cluster otel-collector Service (8b stack, if deployed)
```

## Related code files
- `infra/docker/Dockerfile` (parameterized `ARG APP`, multi-stage builder+runtime), `.dockerignore`.
- `infra/k8s/base/` — per-app `deployment.yaml`/`service.yaml`/`configmap.yaml` (13 apps) + `secret.yaml` (placeholders) + `namespace.yaml` + `kustomization.yaml`; `ingress.yaml` (gateway). 
- `infra/k8s/overlays/dev/` + `overlays/prod/` (kustomization + patches: replicas, resources, image, env). `infra/k8s/infra-dev/` (postgres/redis single-node for local runs).
- App health endpoint (verify/add a `GET /health` returning 200 — a shared tiny controller or per-app; check what exists first).
- `.env.example` / docs note: k3d run instructions; prod-infra-external split.
- Verify: `k3d cluster create` + build catalog+gateway images + `k3d image import` + `kubectl apply -k overlays/dev` (subset) → pods Ready, a request works; `kubectl kustomize` + `kubeconform` on both overlays.

## Implementation steps
1. Parameterized multi-stage `Dockerfile` + `.dockerignore`; build ONE app image locally to prove it (catalog).
2. Health endpoint(s) confirmed/added (probes need a real 200).
3. `base/` manifests for all 13 apps (Deployment/Service/ConfigMap) + placeholder Secrets + namespace + gateway Ingress + base kustomization.
4. `overlays/dev` (subset-runnable, infra-dev component, 1 replica, local images) + `overlays/prod` (registry images, external infra, ≥2 replicas). Both render + `kubeconform`-clean.
5. Verify on k3d: create cluster, import catalog+gateway (+minimal infra) images, apply dev subset, confirm Ready pods + a working request through the Ingress.
6. Update plan before push; PR.

## Todo
- [x] parameterized multi-stage Dockerfile (`ARG APP`, node 24.14, pnpm 10.32.1, non-root, prod deps from generatePackageJson + explicit `pg` for TypeORM's dynamic require) + `.dockerignore`; gateway + catalog images build
- [x] liveness/readiness/startup health endpoint — shared `libs/shared/health` module gives the 12 non-gateway services `/api/v1/health` 200; probes verified live
- [x] `base/` per-app Deployment/Service/ConfigMap (13) + placeholder Secrets + namespace + gateway Ingress + base kustomization (+ startupProbe patch)
- [x] `overlays/dev` (1 replica, local images, infra-dev postgres/redis, `NODE_ENV=production`) + `overlays/prod` (≥2 replicas, registry, external infra); both render + kubeconform-clean (58/58, 51/51)
- [x] k3d live: gateway image built/imported, dev overlay applied, pod 1/1 Ready via real probes, request works through Traefik Ingress (200); catalog connects to Postgres (env-complete)
- [x] no real secrets in manifests (placeholders only); images non-root/lean; overlays DRY (patches); plan updated before push

## Success criteria
- One parameterized Dockerfile builds any of the 13 apps into a non-root, runnable image (proven for ≥1).
- `kubectl kustomize overlays/{dev,prod}` both render and pass `kubeconform`; overlays patch (not duplicate) the base.
- On k3d: the dev-overlay representative subset (gateway+catalog+minimal infra) deploys, pods reach Ready, and a request succeeds through the gateway Ingress.
- No real credentials in any manifest; prod overlay points at external infra via Secrets.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Full 13-service graph won't fit k3d on 16GB | H×M | Verify a representative SUBSET only; ship all manifests but run gateway+catalog+minimal infra; document cloud for full |
| Dockerfile misses a runtime asset (proto/Temporal workflows) | M×H | Copy `dist/apps/<app>/proto`; special-case payment's `TEMPORAL_WORKFLOWS_PATH`; boot the built image (`docker run`) to prove |
| generatePackageJson prod install missing a dep | M×M | `pnpm install --prod` from the generated package.json in the runtime stage; smoke-run the image |
| Real secrets leak into manifests | L×H | Placeholder/dev values ONLY; prod via external secret manager (documented); grep manifests for real creds before commit |
| Overlays drift / duplicate manifests | M×L | Kustomize patches only; both overlays render-tested + kubeconform in CI (8d) |
| Probes hit a non-existent endpoint → crashloop | M×M | Confirm/add a real `GET /health` 200 before wiring probes; test readiness on k3d |

## Security considerations
- No real secrets in git — dev placeholders only; prod via a secret manager / sealed-secrets (documented, wired in 8d). Secrets as `Secret` (not ConfigMap).
- Non-root containers, read-only root fs where feasible, dropped capabilities; `securityContext` set. NetworkPolicy (internal identity-trust hardening from the backlog) is a follow-up noted for prod.
- Images built from pinned base (`node:24.14-slim`); Trivy/Hadolint scanning is 8d.

## Next steps
8c-B: HPA (CPU + a custom metric — Kafka lag / RPS — via prometheus-adapter reading 8b's metrics) + canary/blue-green rollout with health-gated promotion + rollback. 8d: GitHub Actions CI/CD (build/push images to a registry, deploy, health-gate) + Trivy/Hadolint/actionlint + Renovate. NetworkPolicy + sealed-secrets as prod hardening.
