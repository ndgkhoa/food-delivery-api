# Single image — one `food-delivery-api` for all 13 services

Context: [plan.md](./plan.md) · [phase-08c-a-k8s-manifests-dockerfiles.md](./phase-08c-a-k8s-manifests-dockerfiles.md) · [backlog-fix-runtime-image-cve.md](./backlog-fix-runtime-image-cve.md)

## Overview
- **Priority**: user-directed. Consolidate the **13 per-service images** into **ONE** image `ghcr.io/ndgkhoa/food-delivery-api` (matching the user's other repos: `booking-platform-api`, `order-management-api`). A launcher selects the service at runtime via `APP`.
- **Status**: ✅ Verified live — branch `feat/single-image`. Awaiting review/merge.
  - **Live proof (built the real image + booted every service)**: `docker build` the one `food-delivery-api:dev` (933MB) → ran it 13× with `-e APP=<svc>`; **all 13** (gateway/catalog/auth/order/search/delivery/media/payment/config/review/analytics/inventory/notification) loaded + reached Nest bootstrap (fail only on missing env — expected), so the merged union of every app's prod deps is complete — no MODULE_NOT_FOUND on any service, including the native ones (kafka/sharp/temporal). Launcher fails closed: no `APP` → error+exit1, `APP=../etc` → "must name a service" (traversal blocked). **trivy 0 unignored HIGH/CRITICAL** (the libssl3 + quinn-proto ignores carry over). kustomize base/dev/prod + both rollout dirs build; actionlint clean; no `food-delivery/<app>` image ref remains under infra/k8s.
- **User-accepted trade-off**: the image is large (~union of all deps incl. @temporalio ~700MB) and builds are coupled (any service change rebuilds the one image), losing independent per-service deploys — accepted for a single, simpler artifact.

## Design
- **Dockerfile** (`infra/docker/Dockerfile`) — 3 stages, single fat image:
  - `builder` (node-slim): build ALL 13 apps — `pnpm nx run-many -t build --projects <13 apps> --configuration=production` (NOT `--all` — that includes e2e/libs; list the 13 service apps). Produces `dist/apps/<app>/main.js` + each app's generatePackageJson'd `package.json`.
  - `deps` (node-slim): merge the **union** of all 13 apps' pruned `dependencies` into one `package.json` (a small `node -e` that reads every `dist/apps/*/package.json` and merges `dependencies`, taking the highest/any version — they come from ONE lockfile so versions agree), then `npm install --omit=dev` (+ `pg@8.22.0`, + the js-yaml range override from the CVE fix). Copy the Temporal workflows. Result: `/app/dist/apps/*` + `/app/node_modules` (shared) + `/app/workflows`.
  - `runtime` = `gcr.io/distroless/nodejs24-debian12:nonroot`: `COPY --from=deps /app /app`, `COPY infra/docker/launcher.js /app/launcher.js`, `ENV NODE_ENV=production`, `TEMPORAL_WORKFLOWS_PATH=/app/workflows`, `WORKDIR /app`, `CMD ["launcher.js"]`.
- **`infra/docker/launcher.js`** (NEW): reads `process.env.APP`, validates it, `require('/app/dist/apps/'+APP+'/main.js')`. Exits 1 with a clear message if `APP` unset/invalid. Node resolves each app's `require`s from the shared `/app/node_modules` (walk-up).
- **CD** (`.github/workflows/cd.yml`): the `build-push` matrix (13) → a SINGLE build job for `food-delivery-api` (no `APP` build-arg, no per-app matrix/scope). Sign + `attest-build-provenance` + self-verify the ONE image. `image-scan` matrix (13) → ONE scan of `food-delivery-api`. `deploy` "Pin prod images" loop (13) → pin the single `food-delivery/all` → `ghcr.io/ndgkhoa/food-delivery-api:sha` for every app image the overlay declares (or just the one).
- **k8s base** (13 `deployment.yaml`): `image: food-delivery/<app>:dev` → `image: food-delivery-api:dev`; add `APP: <service>` — cleanest via each service's existing `<svc>-config` ConfigMap (add `APP`), OR an explicit `env: [{name: APP, value: <svc>}]` on the container. Keep everything else (probes/securityContext/ports/envFrom).
- **prod overlay** (`kustomization.yaml`): the 13 `food-delivery/<app>` `images:` entries → ONE `food-delivery-api` → `ghcr.io/ndgkhoa/food-delivery-api` (newTag from CD). (The `images:` transformer rewrites the single base image name for all Deployments.)
- **rollout** (`canary/rollout.yaml`, `blue-green/rollout.yaml`): gateway image → `food-delivery-api:dev` + `APP=gateway`.
- **Delete the 13 old GHCR packages** (`ghcr.io/ndgkhoa/<app>`) after the single image builds + verifies — a separate step once the new package exists.

## Related files
- `infra/docker/Dockerfile` (rewrite), NEW `infra/docker/launcher.js`, `.github/workflows/cd.yml`, 13× `infra/k8s/base/*/deployment.yaml`, `infra/k8s/overlays/prod/kustomization.yaml`, `infra/k8s/rollout/{canary,blue-green}/rollout.yaml`. Update the Dockerfile header comment (build command changes).

## Adversarial review — ship-ready, no Critical/High
Report `../reports/code-reviewer-260803-single-image-review-report.md`. The dep union is a **superset** of any per-app image (Object.assign of every app's pruned `dependencies`; native deps exact-pinned; `pg` + js-yaml override carried over) → strictly SAFER than per-app on missing-deps; launcher blocks traversal + fails closed; all runtime assets (protos via CopyPlugin, TypeORM migrations, Temporal workflows) are `__dirname`-relative and preserved per-app under `/app/dist/apps/<app>/`; CD/k8s consistent (no leftover `matrix.app`). Findings: **F1 (Low)** merge takes only `dependencies` — **verified nil**: all 13 app manifests are `dependencies`-only (checked in the built image), nothing dropped. F2/F3 (floating carets pre-existing; merge assumes package.json — fails loud) accepted. **F4 (info)** added a comment tying the Dockerfile's 13-app list to the k8s Deployments. **F5 (info)** added a superseded note to phase-08d.

## Todo
- [x] Dockerfile: build all 13 apps, merge union deps, distroless runtime + launcher
- [x] `launcher.js` (APP selector, fail-closed on unset/invalid + traversal-blocked)
- [x] CD: single build/sign/attest/scan `food-delivery-api`; deploy pin → single image
- [x] 13 base deployments → single image + `APP`; prod overlay images → single; rollout manifests → single + APP
- [x] verified: built the image (933MB); booted ALL 13 via `-e APP=<svc>` (Nest bootstraps, native modules load); trivy 0 unignored HIGH/CRITICAL; kustomize base/dev/prod + rollout build; actionlint clean
- [ ] delete the 13 old GHCR per-service packages — AFTER merge + the develop CD builds the new `food-delivery-api` package; plan updated before push

## Success criteria
- `docker run -e APP=<svc>` on `food-delivery-api` starts each of the 13 services (Nest bootstraps; native kafka/sharp/temporal load for their services; fails only on missing env).
- CD has ONE build + ONE sign/attest + ONE image-scan for `food-delivery-api` (was 13 each).
- kustomize base/dev/prod build with every Deployment on the single image + its `APP`.
- trivy: 0 unignored HIGH/CRITICAL on the one image.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Union deps miss a service's runtime dep | M×H | Merge ALL 13 pruned manifests' `dependencies`; boot-test the diverse services (kafka/sharp/temporal/pg/grpc) from the one image |
| Image very large / slow pulls | H×L (accepted) | User-accepted; distroless base keeps it as small as a fat image can be; one layer of node_modules shared |
| Launcher can't resolve an app's node_modules | M×M | Shared `/app/node_modules` at the root; node walk-up resolves; boot-test proves it |
| A service needs a DIFFERENT env/config not in its ConfigMap | L×M | Each keeps its own `<svc>-config` ConfigMap via envFrom; only `APP` is added |
| Deleting GHCR packages is destructive | L×M | Only after the new image is built + verified; the old per-service packages are superseded |

## Security considerations
- Same distroless hardening (nonroot, readOnlyRootFilesystem via k8s, dropped caps) + the CVE ignores carry over. The launcher only `require`s a path built from `APP` under the fixed `/app/dist/apps` — validate `APP` against the known set (or at least that the resolved path exists) so a bad `APP` fails cleanly, never traverses.

## Next steps
After this: delete old GHCR packages, then the deferred follow-ups (gRPC HMAC, OTLP base host, DLQ-replay tool, KUBECONFIG secret cleanup), then merge #51 (release-please) + sync main.
