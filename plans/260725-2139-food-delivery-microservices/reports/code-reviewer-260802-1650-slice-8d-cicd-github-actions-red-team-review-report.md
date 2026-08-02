# Red-Team Review — Slice 8d CI/CD (GitHub Actions + supply-chain scans + Renovate)

Branch `feat/ci-cd-pipeline` · PR #33 (CI ran GREEN, live-verified). Reviewer: code-reviewer.
Scope: `.github/workflows/ci.yml`, `.github/workflows/cd.yml`, `renovate.json`, `.trivyignore`,
`infra/docker/Dockerfile`, `nx.json`. Cross-checked `infra/k8s/overlays/prod/kustomization.yaml`.

## Verdict
No CRITICAL. Highest-value hunts (pull_request_target / script-injection / secret-leak) came back
**clean** — the workflow is fork-safe and the KUBECONFIG rework is sound. The real risks are in the
**CD promotion path**: mutable `:latest` + develop-triggered prod deploy + a shared `.trivyignore`
that reaches the one blocking scan. All CD issues are currently **inert** (no KUBECONFIG wired), but
they activate the moment a cluster is attached.

---

## Clean (do-not-flag, verified sound)
- **No `pull_request_target` anywhere.** CI = `pull_request` (read-only token, no secrets for forks);
  CD = `push` only. Fork-safety is correct.
- **No script injection.** Every `run:` block scanned — no `${{ github.event.* }}` (PR title/branch/
  commit) interpolated into shell. `github.ref_name`/`github.actor`/`github.sha` appear only as
  `with:` inputs on push-triggered CD (controlled branch refs), not in shell.
- **KUBECONFIG handling is sound.** The "`secrets` not valid in step `if:`" rework is the standard
  documented workaround: presence probed in a step where `env:` can read the secret, exposed as a
  boolean `outputs.present`, later steps gate on the output. Only the boolean is echoed — the secret
  is never logged. Write uses `printf '%s'` (not `echo`), `chmod 600`, and env-var indirection (not
  inline `${{ secrets }}` in shell) — no injection/leak. `[ -n "$KUBECONFIG_CONTENT" ]` correctly
  yields `false` when unset.
- **Image-scan actually gates deploy.** `deploy` `needs: [build-push, image-scan]`; CD image scan is
  blocking (`exit-code: "1"`). Any app's HIGH/CRITICAL fails its matrix leg → `needs` unsatisfied →
  deploy blocked. Real runtime-vuln gate. Sound.
- **CI least-privilege confirmed.** Workflow default `contents: read`; `security-events: write` only
  on the trivy job.
- **`.trivyignore` config entries are genuinely dev-only.** Verified `overlays/prod/kustomization.yaml`
  includes only `../../base` — it does NOT pull `infra-dev` (KSV-0014/0118 postgres) or
  `observability/prometheus-adapter` (KSV-0046). Rationale holds: those findings can't reach prod.
- **Hadolint DL3008/DL3066 ignores justified.** git is builder-stage only (runtime is a fresh
  `FROM ... AS runtime` — no git); `node` uid 1000 is baked into node:slim. Runtime is non-root,
  prod-deps-only. No supply-chain pin gap.
- **Orchestrator's Trivy version pin (v0.72.0)** — sound, restores reproducibility.

---

## HIGH

### H1 — `:latest` is mutable, pushed on develop too, and prod pins `:latest` → develop code can land in prod
`cd.yml` build-push tags **unconditionally**:
```
:${{ github.sha }}   :latest   :${{ github.ref_name }}
```
CD triggers on push to **both** `develop` and `main`, so a merge to `develop` overwrites `:latest`
with develop code. `overlays/prod/kustomization.yaml` pins every image to `newTag: latest`, and the
prod patch sets `imagePullPolicy: Always`. Chain: **develop merge → `:latest` overwritten → prod
overlay (latest) + Always pull → develop code served in prod** on the next reconcile/rollout. Even
ignoring develop, prod is pinned to a **mutable** tag — no immutable digest, no reproducible deploy,
no clean rollback. The immutable `:sha` tag is built but discarded by the prod overlay.
- **Repro:** wire KUBECONFIG → merge anything to `develop` → `:latest` moves → prod pulls develop build.
- **Fix:** (a) tag `:latest` only on `main` (`tags:` conditional on `github.ref_name == 'main'`, or a
  metadata-action `flavor`/branch rule); (b) pin the prod overlay to an **immutable** tag — the
  `github.sha` the deploy is promoting (patch `newTag` at deploy time, or use digest pinning), not
  `latest`. Portfolio-acceptable interim: at minimum stop pushing `:latest` from develop.

### H2 — `deploy` job runs on develop pushes and applies the prod overlay (branch/environment mismatch)
`cd.yml` `deploy` has `environment: production`, runs `kubectl apply -k infra/k8s/overlays/prod`, and
has **no branch guard**. Because CD fires on `push: [main, develop]`, a **develop** merge reaches a
job that applies the **prod** overlay to the **prod** cluster. Gated today by the missing KUBECONFIG
and (assumed) the `production` Environment's required-reviewer rule, but semantically develop must
never target prod.
- **Repro:** merge to develop → `deploy (production)` job is created and (with a cluster) applies prod.
- **Fix:** guard the deploy job: `if: github.ref == 'refs/heads/main'` (and/or split a develop→staging
  environment). Keep build-push/image-scan on both branches; restrict only the apply/rollout.

---

## MEDIUM

### M1 — CD `cancel-in-progress: true` can abort a deploy mid-rollout
`concurrency: { group: cd-${{ github.ref }}, cancel-in-progress: true }` applies to the whole CD
workflow, including `deploy`. A newer push cancels an in-flight `kubectl apply` / `rollout status`,
potentially leaving a **partial rollout** (some Deployments updated, others not; health gate never
evaluated). Fine for CI, unsafe for a deploy.
- **Fix:** set `cancel-in-progress: false` for CD (or scope a separate non-cancelling concurrency
  group to the deploy job), so deploys serialize instead of being killed.

### M2 — `.trivyignore` global CVE suppressions also blank the one BLOCKING scan
`CVE-2026-14257` (brace-expansion ReDoS) and `GHSA-pm4m-ph32-ghv5` (js-yaml ReDoS) are suppressed by
**bare ID**, and the CD image scan (`exit-code: "1"`) uses the **same** `.trivyignore`. Both libs are
*common runtime transitives* (js-yaml/minimatch appear under many prod deps). If a shipped image's
generated `package.json` pulls a vulnerable version of either at **runtime**, the blocking image scan
**silently suppresses it** — the exact gate the whole advisory-CI/blocking-CD posture relies on. The
dev-tooling justification only holds for the *fs* scan; the ID suppression isn't path/scope-scoped.
- **Fix:** scope these to the fs scan only — e.g. move to a `.trivyignore.yaml` with a path filter, or
  keep a separate ignore file for CI-fs vs CD-image so runtime occurrences of the same CVE still block.
  At minimum, pin the suppression to the dev-tooling version range and re-check against a real image scan.

### M3 — Prod-overlay k8s misconfig is hard-gated nowhere
CI config scan is advisory (`exit-code: "0"`) and `scan-ref: infra/k8s` covers `overlays/prod` too, so
a genuine HIGH misconfig introduced into the **prod** manifests (privileged container, hostPath,
dropped securityContext) is advisory-only. The CD gate scans image **vulns**, not k8s **config**. Net:
no blocking gate on prod IaC misconfig anywhere. The "non-reproducible checks-bundle" rationale
justified un-gating *dev-infra* findings, but the blanket advisory also un-gates the prod overlay.
- **Fix (documented follow-up acceptable):** a separate **blocking** config scan scoped to
  `infra/k8s/overlays/prod` (+`base`) with a **pinned** misconfig checks-bundle (`TRIVY_CHECKS_BUNDLE`
  digest) so prod misconfig blocks reproducibly, while the drift-prone dev-infra scan stays advisory.

### M4 — CD `packages: write` is workflow-level (inherited default), not job-scoped
`cd.yml` sets `permissions: { contents: read, packages: write }` at the workflow level. Only
`build-push` needs write; `image-scan` and `deploy` override to drop it — but the **default** for any
*future* job added without an explicit `permissions:` block is silently write-to-GHCR.
- **Fix:** set workflow default to `contents: read`; put `packages: write` **only** on `build-push`.

---

## LOW / informational
- **L1 — Action pinning.** Token/registry-handling actions on mutable major tags: `docker/login-action@v3`,
  `docker/build-push-action@v6`, and third-party `raven-actions/actionlint@v2`. SHA-pin the
  registry/token ones (Renovate then bumps the SHA). Already a documented follow-up.
- **L2 — No `timeout-minutes` on any job.** Default 360 min; a hung nx build/deploy burns up to 6h of
  runner minutes. Add per-job timeouts.
- **L3 — Rollout comment overstates.** The deploy step comment says the `infra/k8s/rollout` canary/
  blue-green "is the promotion mechanism this invokes," but the prod overlay includes only `../../base`
  (37 plain `kind: Deployment`; **zero** `kind: Rollout`). `kubectl rollout status deploy --all` does
  correctly gate the plain Deployments — but it is NOT invoking canary/blue-green. Fix the comment (or
  wire `../../rollout` into the overlay) to avoid a false health-gate claim.
- **L4 — `kubeconform -ignore-missing-schemas`** skips CRDs (HPA custom-metrics, any future CRD) → the
  "validate gate" doesn't actually validate those resources. Acceptable tradeoff; note it.
- **L5 — Renovate rule ordering.** The devDeps minor/patch `automerge: true` rule (rule 1) is not unset
  by the OTel lockstep group (rule 3). Inert today (OTel packages are runtime `dependencies`, not
  devDeps), but if any `@opentelemetry/*` ever appears as a devDependency, a patch bump could be
  auto-merged, bypassing the lockstep-review intent. Add `matchDepTypes` exclusion or an explicit
  `automerge: false` on the OTel rule for safety.
- **L6 — `fail-fast: false` on build-push** means a single app build failure blocks the whole deploy
  (image-scan of the missing `:sha` fails) and leaves that app's `:latest` stale while others advance.
  Safe default; just be aware promotion is all-or-nothing per push.

---

## Assessment of already-fixed items (as requested)
- **Advisory-CI + blocking-CD-image posture:** *largely* sound and well-reasoned, but has two holes —
  M2 (shared ignore reaches the blocking scan) and M3 (prod-overlay config un-gated everywhere). The
  dev-infra/dev-tooling rationale is verified correct (prod overlay genuinely excludes infra-dev +
  prometheus-adapter; runtime image is prod-deps-only). Recommend closing M2/M3 to make the posture
  airtight; as-is it's defensible for a portfolio *if* M2/M3 are documented as known gaps.
- **Trivy v0.72.0 pin:** sound, no notes.

## Unresolved questions
1. Is the `production` GitHub Environment actually configured with required-reviewer protection? H2's
   safety today rests on that assumption — it's not visible in the repo (Environment settings are
   server-side). Confirm via repo settings.
2. Intended promotion model: should `develop` deploy to a **staging** environment (implying a second
   overlay + environment), or is CD deploy meant to be `main`-only? H1/H2 fixes differ accordingly.

---
**Status:** DONE_WITH_CONCERNS
**Summary:** No CRITICAL / no RCE — fork-safety, script-injection, and secret handling are clean and
sound. Real risks are in the CD promotion path: mutable `:latest` pushed from develop + prod overlay
pinned to `:latest` (H1), develop pushes triggering the prod-overlay deploy (H2), a shared
`.trivyignore` that blanks the one blocking image scan (M2), and prod IaC misconfig gated nowhere (M3).
All inert until a KUBECONFIG cluster is wired, but they activate on day one of a real deploy.
**Concerns:** H1/H2 are latent prod-safety bugs, not portfolio cosmetics — fix before attaching any
cluster. M2/M3 are holes in the otherwise-sound advisory/blocking Trivy split.
