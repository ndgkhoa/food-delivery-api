# Slice 8d — CI/CD (GitHub Actions) + supply-chain scans + Renovate

Context: [phase-08.md](./phase-08-ops-observability.md) · [phase-08c-a-k8s-manifests-dockerfiles.md](./phase-08c-a-k8s-manifests-dockerfiles.md) · [phase-08c-b-hpa-canary-rollout.md](./phase-08c-b-hpa-canary-rollout.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2 — final P8 slice (after 8a tracing #29, 8b metrics/logs #30, 8c-A manifests #31, 8c-B rollout #32). Completes the project.
- **Status**: ✅ Implemented + locally verified — branch `feat/ci-cd-pipeline`. Single PR. Live `gh run` on the PR is the final proof (pending push).
- **Brief**: Wire **GitHub Actions CI/CD**. **CI** (on every PR + push to main/develop): `nx affected` lint/test/build + the repo's biome/cruiser/knip gates + **actionlint** (self-lint the workflows) + **Hadolint** (the Dockerfile) + a **Trivy** IaC/config scan (k8s manifests + Dockerfile). **CD** (on push to develop/main): build + push the 13 service images to **GHCR** via the ONE parameterized 8c-A Dockerfile (matrix over apps), a **Trivy image scan**, then an **environment-gated deploy** that renders + `kubeconform`-validates the prod overlay and (behind a real-cluster secret) rolls it out with a **health gate** using 8c-B's canary/blue-green. Enable **Renovate** for dependency + Docker-base + Actions-version update PRs. The CI workflow proves itself: it RUNS on this slice's own PR.

## Key decisions (verify action versions live)
- **CI = fast checks, CD = images + deploy** (don't build 13 images on every PR — expensive). CI runs `nx affected` (lint/test/build) + biome + cruiser + knip + actionlint + hadolint + a Trivy config/fs scan; CD (post-merge) does the image matrix + push + image scan + gated deploy.
- **`nx affected` with `nrwl/nx-set-shas`** (verify latest major): checkout `fetch-depth: 0`, derive the base/head SHAs, run `nx affected -t lint test build --base=$NX_BASE --head=$NX_HEAD`. On `main`/`develop` push, base = the previous commit. No Nx Cloud token in the repo → `NX_CLOUD_ACCESS_TOKEN` unset, local cache only (fine). There is NO `typecheck` target in this repo (tsc runs inside `build`/`test` via webpack/jest) — do NOT invent one; rely on build+test. `lint` = biome (the repo's `lint` script is `biome check .`).
- **Caching**: `actions/setup-node` with `cache: pnpm` (+ `pnpm/action-setup@v4` pinned to `packageManager` 10.32.1) for the pnpm store; cache the `.nx/cache` keyed by the lockfile + sources for Nx.
- **Node/pnpm**: `node-version: 24.14.0` (matches `engines`), pnpm 10.32.1, `pnpm install --frozen-lockfile`.
- **Supply-chain scans**: **actionlint** (lint every workflow — catches expression/typo bugs), **Hadolint** (`infra/docker/Dockerfile` — fix or `# hadolint ignore=` any real findings), **Trivy** `config` mode over `infra/k8s` + `infra/docker` (IaC misconfig: privilege, latest-tag, missing limits) + a `fs` scan for vulnerable deps. Upload SARIF to the GitHub Security tab where the token allows (`security-events: write`); otherwise table output + fail on HIGH/CRITICAL with a documented allowlist.
- **CD images → GHCR**: `docker/build-push-action` (buildx) matrix over the 13 apps, `--build-arg APP=<app>`, context = repo root, the ONE `infra/docker/Dockerfile`. Tag `ghcr.io/ndgkhoa/<app>:<git-sha>` + `:latest` (+ `:develop` on develop). Auth via the built-in `GITHUB_TOKEN` (`packages: write`). Layer cache via GHA cache (`cache-from/to: type=gha`). Trivy scans each pushed image (fail on HIGH/CRITICAL, allowlist documented).
- **CD deploy = environment-gated + health-gated, honest about no prod cluster**: a `deploy` job bound to a GitHub **Environment** (`production`, required-reviewer protection) that always renders + `kubeconform`-validates `overlays/prod`, and — ONLY when a `KUBECONFIG` secret is present (not set in this portfolio repo) — runs `kubectl apply -k overlays/prod` then `kubectl rollout status` as the **health gate** (promote on healthy, the job fails → no promotion on a bad rollout). With no secret it stops at validate + logs "no cluster configured — deploy is a documented gate". The canary/blue-green from 8c-B is the rollout mechanism this would invoke (documented in the job/plan; a full progressive rollout via Argo is the 8c-B-noted prod alternative).
- **Renovate**: a `renovate.json` (config:recommended base) enabling npm + Dockerfile base-image + `github-actions` managers; group minor/patch, separate majors, a schedule (off-peak), automerge for lockfile-only dev-dep patches, and `packageRules` pinning the OTel packages together (they must move in lockstep — see the OTel version-conflict history). Enable the Renovate GitHub App on the repo (a manual step — documented; the config lands here).
- **Concurrency + permissions**: `concurrency: {group: <workflow>-<ref>, cancel-in-progress: true}`; least-privilege `permissions:` per workflow (CI: `contents: read`; +`security-events: write` for SARIF; CD: `contents: read, packages: write`). Pin actions to a major (or SHA) — Renovate then keeps them current.

## Requirements
**Functional**: a PR runs CI (nx-affected lint/test/build + biome/cruiser/knip + actionlint + hadolint + Trivy config) and blocks on failure; a merge to develop/main builds+pushes the 13 images to GHCR, scans them, and reaches an environment-gated deploy that validates prod manifests (+ rolls out behind a cluster secret with a health gate); Renovate opens dependency/Docker/Actions PRs. **Non-functional**: workflows actionlint-clean; least-privilege permissions; concurrency-cancel; caching; scans fail on HIGH/CRITICAL with a documented allowlist; no secrets in workflows (OIDC/GITHUB_TOKEN only); the CI workflow passes ON THIS PR (the live proof).

## Architecture / data flow
```
PR / push ─▶ ci.yml: setup(pnpm,node24) → nx-set-shas → nx affected(lint,test,build)
                     + biome + cruiser + knip + actionlint + hadolint + trivy config/fs   → required check
push develop/main ─▶ cd.yml: matrix[13 apps] docker buildx --build-arg APP=<app> → push ghcr.io/ndgkhoa/<app>
                     → trivy image scan → deploy(env: production, gated): kustomize+kubeconform
                       → [if KUBECONFIG] kubectl apply -k overlays/prod → rollout status (health gate)
renovate.json ─▶ Renovate App: npm + dockerfile + github-actions update PRs (grouped, OTel pinned lockstep)
```

## Related code files
- `.github/workflows/ci.yml` (PR/push: affected lint/test/build + biome/cruiser/knip + actionlint + hadolint + trivy config/fs), `.github/workflows/cd.yml` (image matrix → GHCR + trivy image + gated deploy), optionally split a `security.yml` (or keep Trivy in ci/cd). 
- `renovate.json` (repo root) — managers + grouping + OTel lockstep rule + schedule.
- `infra/docker/Dockerfile` — apply any Hadolint fixes (or documented `hadolint ignore` with reason).
- `package.json` — (optional) a `ci` convenience script; a `nx affected` wrapper if helpful. `.dockerignore` already present.
- Docs: a short CI/CD note in the plan (badges/README optional). `nx.json` — (optional) set `defaultBase: develop` so local `nx affected` matches CI.
- Verify: **actionlint** all workflows; **hadolint** the Dockerfile; **trivy config** infra/k8s+infra/docker; `renovate-config-validator` renovate.json; run each CI command locally; **LIVE: push → `gh run watch` the CI workflow on this PR → green**.

## Implementation steps
1. `ci.yml`: setup (pnpm@10.32.1, node 24.14, `--frozen-lockfile`, pnpm+nx cache), nx-set-shas, `nx affected -t lint test build`, biome, cruiser, knip, actionlint, hadolint, trivy config/fs. Concurrency + least-priv permissions.
2. `cd.yml`: matrix build+push 13 images to GHCR (parameterized Dockerfile), trivy image scan, environment-gated deploy (kustomize+kubeconform always; kubectl apply+rollout-status behind KUBECONFIG secret).
3. `renovate.json`: npm+dockerfile+github-actions managers, grouping, OTel lockstep pin, schedule, safe automerge.
4. Hadolint the Dockerfile; fix or justify findings.
5. Verify: actionlint + hadolint + trivy + renovate-config-validator locally; run the CI commands; then PUSH and watch the CI run go green on the PR.
6. Update plan before push; PR.

## Todo
- [x] `ci.yml`: nx-affected lint/test/build + biome/cruiser/knip + actionlint + hadolint + trivy config/fs; pnpm/nx cache; concurrency; least-priv perms
- [x] `cd.yml`: matrix build+push 13 images to GHCR (one parameterized Dockerfile) + trivy image scan + env-gated, health-gated deploy (kustomize+kubeconform + optional kubectl behind KUBECONFIG)
- [x] `renovate.json`: npm + dockerfile + github-actions managers, grouping, OTel-lockstep pin, schedule, safe automerge
- [x] Hadolint the Dockerfile (fix/justify); Trivy config scan clean (or documented allowlist)
- [x] verify: actionlint + hadolint + trivy + renovate-config-validator + local CI commands; LIVE CI run green on this PR (`gh run`) — pending push (orchestrator)
- [x] plan updated before push

## Success criteria
- CI runs on this slice's PR and passes (nx-affected lint/test/build + biome/cruiser/knip + actionlint + hadolint + trivy) — verified via `gh run`.
- CD (on merge) builds+pushes the 13 images to GHCR and reaches an environment-gated deploy that validates the prod overlay (rolls out with a health gate when a cluster secret is present).
- Renovate config is valid and the manager set covers npm + Docker base + GitHub Actions; OTel packages grouped to move in lockstep.
- Workflows are actionlint-clean, least-privilege, concurrency-guarded; no plaintext secrets.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| `nx affected` misconfigured → skips changed projects or fails on base SHA | M×M | `nrwl/nx-set-shas` + `fetch-depth:0`; verify the affected graph on the PR run; fallback to run-many if base resolution flaky |
| CD builds 13 images on every push → slow/costly | M×M | Only on develop/main push (not PRs); GHA layer cache; matrix parallel; images are the same lean Dockerfile |
| Trivy/Hadolint fail the build on unfixable/base-image CVEs | M×M | Fail on HIGH/CRITICAL with a DOCUMENTED `.trivyignore`/hadolint-ignore allowlist (reason per entry); Renovate bumps bases to clear them |
| Deploy job has no real cluster | H×L | Env-gated + validate-only unless `KUBECONFIG` secret set; documented as a portfolio gate, not a broken step |
| Leaked secret / over-broad token | L×H | GITHUB_TOKEN + least-priv `permissions:` per workflow; no PATs; OIDC if a cloud deploy is added |
| Action supply-chain (a compromised tag) | L×M | Pin actions to a major (Renovate updates); optionally SHA-pin the security-sensitive ones |

## Security considerations
- Least-privilege `permissions:` per workflow; `GITHUB_TOKEN` only (no PATs); `packages: write` only on CD; `security-events: write` only where SARIF is uploaded.
- Trivy (image + IaC) + Hadolint gate the supply chain; fail on HIGH/CRITICAL with a documented allowlist; Renovate keeps deps + bases patched.
- No secrets in workflow YAML; real deploy creds via a GitHub Environment secret (`KUBECONFIG`) with required-reviewer protection; images are non-root (8c-A).
- `pull_request` from forks runs with a read-only token (no package push / no secrets) — CD is push/protected-branch only.

## Next steps
**Completes the project (P0–P8).** Follow-ups (tracked backlog): SHA-pin actions; SLSA/provenance + cosign image signing; Argo Rollouts for automated progressive delivery gated on 8b SLOs; the collector `k8sattributes` fix to activate the 8c-B custom-metric HPA; NetworkPolicy + sealed-secrets; the deferred items in plan.md (global error envelope, optimistic locking, internal-identity HMAC, prod Keycloak realm).
