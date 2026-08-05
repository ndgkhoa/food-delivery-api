# Code review — single `food-delivery-api` image (branch `feat/single-image`)

Reviewer: code-reviewer · Date: 2026-08-03
Scope: `infra/docker/{Dockerfile,launcher.js}`, `.github/workflows/cd.yml`, 13× `infra/k8s/base/*/deployment.yaml`, `infra/k8s/overlays/{dev,prod}/kustomization.yaml`, `infra/k8s/rollout/{blue-green,canary}/rollout.yaml`. Verified against develop.

## Verdict
Ship-ready. **No Critical / No High.** The consolidation is correct and, for the highest-risk axis (missing runtime deps), strictly SAFER than the old per-app images. Findings below are Low / informational hardening + a docs-sync follow-up. The lead's boot test of gateway/catalog/order/payment/media covers the diverse native-module surface (grpc/temporal/pg/sharp); the union-merge design means the non-boot-tested services (auth/search/delivery/config/review/analytics/inventory/notification) carry no extra missing-dep risk.

## Why the two headline risks do NOT materialize

### Dependency-union correctness — SAFE (superset)
- All 13 apps have `generatePackageJson: true` (each `apps/*/webpack.config.js:21|30`). The merge `node -e` (`Dockerfile:109`) does `Object.assign(deps, p.dependencies)` over every `dist/apps/*/package.json` → the union is a **superset** of every individual app's pruned deps. No service can lose a dep that generatePackageJson captured; the old per-app image had strictly *less*.
- **Version last-write-wins is a no-op here.** Direct deps are single-versioned in the monorepo root (`package.json`): native/critical packages are exact-pinned (`sharp 0.35.3`, `@confluentinc/kafka-javascript 1.10.0`, `@temporalio/* 1.21.1`, `pg` added `8.22.0`). generatePackageJson emits the root-declared version, identical across apps → merge collision resolves to the same value. Multi-version only occurs for *transitive* deps, which npm nests at install time (not via the top-level manifest).
- `pg` gap correctly preserved: TypeORM `require('pg')` is dynamic → invisible to webpack → pruned from every manifest → re-added explicitly at `Dockerfile:109` (`deps['pg']='8.22.0'`). Matches the old image's `--save=false pg@8.22.0`.
- js-yaml CVE override carried over verbatim (`overrides:{'js-yaml@>=5.0.0 <5.2.2':'5.2.3'}`, `Dockerfile:109`) — same selector the prior verified CVE fix used.
- Native binaries: sharp/kafka resolve their *own* optionalDependencies (linux-x64 glibc binaries) during `npm install` on `node:24-slim`; runtime is distroless debian-12 glibc x64 → ABI-compatible. Unchanged from old image.

### Launcher safety + asset resolution — SAFE
- `launcher.js:5` `/^[a-z-]+$/` rejects `.`/`/`/`..` → no path traversal; `existsSync` gate (`:10`) fails closed on unknown/unbuilt `APP` (e.g. `APP=payment-e2e` → not built by run-many → exit 1). `require(absolute)` (`:14`) has no try/catch — correct: a bootstrap failure should crash the pod (visible CrashLoop), not be swallowed.
- Node module walk-up: from `/app/dist/apps/<app>/main.js`, resolution walks to `/app/node_modules` (shared) — on the path. Verified layout: `Dockerfile:82` copies `dist/apps/` under `/app/dist/apps/`, node_modules at `/app/node_modules`.
- **Runtime assets are `__dirname`-relative → preserved per-app**, so the shared layout doesn't drift them:
  - gRPC protos: webpack CopyPlugin writes them to `<app-dist>/proto` (`apps/{catalog,order,inventory}/webpack.config.js:23-25`); `resolveProtoPath` (`libs/shared/contracts/src/proto-paths.ts:24-25`) resolves `join(__dirname,'proto',…)` = `/app/dist/apps/<app>/proto/*.proto`. Intact.
  - TypeORM migrations: `join(__dirname,'migrations',…)` = `/app/dist/apps/<app>/migrations`. Intact.
  - Temporal workflows: only payment reads `TEMPORAL_WORKFLOWS_PATH=/app/workflows` (`Dockerfile:125`); source copied (`Dockerfile:87`), spec/test stripped (`:90`). `resolveWorkflowsPath` (`temporal-worker.provider.ts:85`) `resolve(override)` = absolute `/app/workflows`. Intact.
- **cwd shift is harmless.** New layout: `WORKDIR /app` so `process.cwd()==/app` but `__dirname==/app/dist/apps/<app>` (old image had them coincide at `/app`). The only `process.cwd()` use in the codebase is `proto-paths.ts:26`, and it's the *third* candidate after the two `__dirname` ones — never reached in-container. No other code loads assets via cwd/relative paths (no ServeStatic, no envFilePath — config is env/ConfigMap driven).
- Signals: `require()` runs main.js in the SAME process (PID1 = `node launcher.js`), so Nest `enableShutdownHooks` (present in all 13 apps) still receives SIGTERM. No signal-forwarding shim needed.

### CD — correct, no leftover matrix
- Single build (`cd.yml:68`, no APP build-arg), `cache-*: scope=food-delivery-api`, `provenance:false` (lets attest-build-provenance be sole source). Sign-by-digest + attest + anchored self-verify (`:97-132`) on the one image. Single trivy scan with `limit-severities-for-sarif:true` + image-scoped `.trivyignore` (`:160-176`). No `matrix.app` / `food-delivery/<app>` references remain in `.github/workflows/`.
- Deploy pin `kustomize edit set image food-delivery-api=…:${GITHUB_SHA}` (`:262`) matches the base image name → single rewrite covers all 13 Deployments. Branch guard (`main` only) + immutable-sha pin + reachability probe intact. `ci.yml` unchanged (hadolint + trivy config/fs only; no image build).

### k8s — consistent
- All 13 base `deployment.yaml`: `image: food-delivery-api:dev` + `APP` env matching the service name (analytics/auth/catalog/config/delivery/gateway/inventory/media/notification/order/payment/review/search — all correct, all match `/^[a-z-]+$/`). Explicit container `env` beats any `envFrom` collision.
- prod overlay: single `images:` entry `food-delivery-api → ghcr.io/ndgkhoa/food-delivery-api:latest` (`overlays/prod/kustomization.yaml:42-45`) rewrites all 13. dev overlay: comment-only change. Rollouts (canary + blue-green): `food-delivery-api:dev` + `APP: gateway`.

## Findings

### Low
1. **Merge extracts only `dependencies` — drops `optionalDependencies`/`peerDependencies` the old install honored.** `Dockerfile:109` merges `p.dependencies` only; the old per-app stage ran `npm install` on the *full* generated manifest (all keys). Evidence says impact is nil (root `package.json` declares no optionalDependencies; `@nx/webpack` 23.1.0 `generatePackageJson` emits `dependencies`), but it's the one behavioral delta from the old verified image not *proven* equivalent, and it would fail silently on a non-boot-tested service. **Fix (cheap):** during boot test, print one generated manifest's keys (`node -e "console.log(Object.keys(require('/app/dist/apps/notification/package.json')))"`) to confirm `dependencies` only; OR defensively also merge `optionalDependencies`/`peerDependencies` in the `node -e`.
2. **`npm install` in `deps` floats caret-ranged deps (no lockfile).** `@grpc/grpc-js ^1.14.4`, `@grpc/proto-loader ^0.8.1`, `ioredis ^5.11.1` can drift at build time. PRE-EXISTING (old per-app image did the same); native/critical deps are exact-pinned so ABI-sensitive ones don't float. Not introduced by this refactor — note only.
3. **Merge assumes every `dist/apps/*` entry has `package.json`.** `Dockerfile:109` `readFileSync('dist/apps/'+a+'/package.json')` throws ENOENT if run-many ever emits a stray dir. Fails at *build* (loud), not runtime — acceptable. No change needed.

### Informational
4. **Hardcoded 13-app build list has no sync guardrail.** `Dockerfile:65` app list must stay in lockstep with the 13 base Deployments and any newly added service; nothing enforces it. Maintenance note for when a 14th service lands.
5. **Stale plan/report docs describe the OLD per-app CD.** `plans/…/phase-08d-cicd-github-actions.md:26,38` and `…/reports/fullstack-developer-260802-1001-…report.md:78,85` still reference the 13-app matrix, `--build-arg APP=<app>`, and `ghcr.io/ndgkhoa/<app>`. Not deployment code — docs-sync follow-up so future readers aren't misled.

## Checklist
- Concurrency: n/a (build/deploy config; launcher single-process). ✓
- Error boundaries: launcher fails closed on bad APP; bootstrap errors crash pod (intended). ✓
- API contracts: node walk-up resolves shared node_modules; asset paths `__dirname`-relative preserved. ✓
- Backwards compat: image name/tag change is intentional (documented in spec); k8s/CD updated in lockstep. ✓ (old GHCR package cleanup is a separate planned step)
- Input validation: `APP` regex + existsSync, fail-closed, no traversal. ✓
- Auth/authz: CD keyless signing + anchored self-verify + branch-guarded prod deploy unchanged. ✓
- Data leaks: none (no secrets in image; distroless nonroot; world-readable app files only). ✓
- Fact-check: build list = 13 service apps (not e2e/libs); all APP values + image refs grep-verified. ✓

## Unresolved questions
- None blocking. Optional: confirm no generated per-app manifest carries `optionalDependencies`/`peerDependencies` (Finding 1) during the boot test — one-liner above.
