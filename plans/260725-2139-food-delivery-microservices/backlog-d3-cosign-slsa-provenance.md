# Backlog D3 — cosign image signing + SLSA provenance

Context: [plan.md](./plan.md) · [phase-08d-cicd-github-actions.md](./phase-08d-cicd-github-actions.md)

## Overview
- **Priority**: portfolio-plus — third D-item. Extends the 8d CD pipeline.
- **Status**: ✅ COMPLETE — merged (#43); signing verified live on the develop CD run.
  - **Live CD proof (develop run 30783493444, post-merge)**: **all 13 `build + push` jobs succeeded**, and each `Verify signature (self-check)` step's `cosign verify` output carries BOTH `type: https://sigstore.dev/cosign/sign/v1` (the signature) AND `type: https://slsa.dev/provenance/v1` (the SLSA provenance) — verified against the anchored `…/cd.yml@refs/heads/develop` identity + the GitHub OIDC issuer. So keyless signing + SLSA provenance + the self-verify gate all work end-to-end across every image. `deploy` correctly skipped (develop, not main).
  - **Unrelated pre-existing failure noted**: the separate `trivy image scan` jobs (`needs: build-push`) fail on HIGH/CRITICAL CVEs in the debian-12 runtime base — red on EVERY recent develop CD run (before D3 too), untouched by this change. Tracked as a separate maintenance item, not part of D3.
  - **Adversarial review** (report `../reports/code-reviewer-260803-cosign-slsa-provenance-review-report.md`): **no Critical/High** — the invariant holds (a broken sign/verify fails the job → `image-scan`/`deploy` skip via `needs`, so an unverifiable image never ships or promotes). Verified correct: the permission set, sign/attest **by digest** (`build-push-action@v6` emits `digest` on push; `attest-build-provenance@v4` wants `sha256:…`), the top-level-workflow keyless SAN, and the fail-closed step ordering. Fixes applied:
    - **M1** — the verify `--certificate-identity-regexp` was unanchored with unescaped dots (cosign matches unanchored). **Fixed**: fully anchored `^https://github\.com/<repo>/\.github/workflows/cd\.yml@refs/heads/(main|develop)$` in both the self-verify step and the consumer comment.
    - **L1** — `build-push-action@v6` attaches its own BuildKit provenance by default, duplicating the SLSA attestation + making an OCI index. **Fixed**: `provenance: false` on the build step so `attest-build-provenance` is the single source.
    - **L2** — pinned the cosign BINARY (`cosign-release: v3.1.2`, verified latest) for a reproducible signer, not just the installer action.
    - L3 (templating `github.repository` into `run`) — moot: the value is a safe owner/repo charset and now sits in a single-quoted regexp (no shell expansion).
- **Brief**: The CD `build-push` job (`.github/workflows/cd.yml`) builds + pushes 13 service images to GHCR but they are **unsigned + have no provenance** — a consumer can't verify who built an image or how. Add **keyless cosign signing** (Sigstore/Fulcio/Rekor, no key management) + a **SLSA build-provenance attestation** (`actions/attest-build-provenance`) per image, and have the job **self-verify** the signature so a broken signing config fails CD.

## Key facts (scouted)
- `build-push` is a matrix over 13 apps; each builds via `docker/build-push-action@v6` (`push: true`, tags from `docker/metadata-action`). Job already has `contents: read` + `packages: write`.
- CD runs **post-merge only** (`on: push: [main, develop]`) — never on a feature-branch PR. So the actual signing runs on the first `develop` merge, NOT on this PR. Pre-merge gates: **actionlint** (runs on the PR) + review + version pinning. Post-merge: the CD run self-verifies + I confirm via `gh run`.
- Verified action versions live: `actions/attest-build-provenance@v4` (moving major tag exists) and `sigstore/cosign-installer` has **no** `@v4` major tag → pin exact **`@v4.1.2`** (latest). Renovate keeps both current (the OTel-lockstep-style config already tracks actions).

## Design (additions to the `build-push` job)
- **Permissions** += `id-token: write` (keyless OIDC for both cosign and the attestation) and `attestations: write` (for `attest-build-provenance` to push the attestation to GHCR). Keep `packages: write`.
- **Digest**: give the build step `id: build`; sign/attest **by digest** (`steps.build.outputs.digest`) — one manifest digest covers every tag (sha/branch/latest), so signing the digest signs them all.
- **Steps after build+push** (per matrix app):
  1. `sigstore/cosign-installer@v4.1.2`.
  2. **Sign (keyless)**: `cosign sign --yes "${IMAGE}@${DIGEST}"` — Fulcio issues a short-lived cert bound to the workflow's OIDC identity; the signature + cert land in Rekor (public transparency log) and GHCR.
  3. **SLSA provenance**: `actions/attest-build-provenance@v4` with `subject-name`/`subject-digest`/`push-to-registry: true` — a signed SLSA-provenance predicate describing the build, attached to the image in GHCR.
  4. **Self-verify**: `cosign verify --certificate-identity-regexp <this workflow> --certificate-oidc-issuer https://token.actions.githubusercontent.com "${IMAGE}@${DIGEST}"` — fails the job if the signature/identity doesn't validate, so a misconfigured signing step can't ship silently.
- **Consumer verification** (documented in the plan + a cd.yml comment, not a new docs file — docs deferred): `cosign verify --certificate-identity-regexp 'https://github.com/ndgkhoa/food-delivery-api/.github/workflows/cd.yml@.*' --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/ndgkhoa/<app>:<sha>` and `gh attestation verify oci://ghcr.io/ndgkhoa/<app>:<sha> --owner ndgkhoa`.

## Related files
- `.github/workflows/cd.yml` — `build-push` job: permissions, `id: build`, cosign install/sign/verify, attest-build-provenance. No other file.

## Todo
- [ ] `build-push`: `id-token`/`attestations` perms; `id: build`; cosign install + keyless sign by digest; attest-build-provenance; self-verify step
- [ ] actionlint clean (CI on the PR); action versions pinned as verified
- [ ] document the consumer verify commands (plan + cd.yml comment)
- [ ] plan updated before push; post-merge: confirm the develop CD run signs + self-verifies (via `gh run`)

## Success criteria
- actionlint passes on the PR; the workflow is syntactically + permission-correct.
- On the first `develop` CD run: every image is signed (cosign) + carries a SLSA provenance attestation, and the in-job `cosign verify` passes (a broken config would fail the run).
- A consumer can `cosign verify` the signature (identity = this workflow, issuer = GitHub OIDC) and `gh attestation verify` the provenance.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Can't fully run CD on the feature branch (post-merge only) | H×L | actionlint + review pre-merge; the job self-verifies; confirm the develop CD run post-merge via `gh run` — same "verify CD post-merge" posture 8d itself used |
| Wrong keyless identity regexp → verify fails / false-accepts | M×M | Identity regexp bound to `…/cd.yml@…` + the GitHub OIDC issuer; self-verify in the job catches a wrong config immediately |
| `attest-build-provenance` needs perms the job lacks | M×M | Add `id-token: write` + `attestations: write`; `packages: write` already present for the registry push |
| Signing adds CD time/flakiness across 13 images | L×L | Keyless sign + attest are quick; matrix already parallel; no key infra to fail |
| cosign-installer has no `@v4` moving tag | L×L | Pin exact `@v4.1.2` (verified latest); Renovate bumps it |

## Security considerations
- Keyless (no long-lived signing key to leak/rotate) — trust roots in the GitHub OIDC identity + Sigstore's transparency log. The signature proves the image came from THIS repo's CD; the SLSA provenance proves how it was built.
- `id-token: write` is scoped to the `build-push` job only (workflow default stays `contents: read`); the OIDC token is short-lived + audience-bound.
- Self-verify closes the "signed but unverifiable" gap — the pipeline asserts its own output.

## Next steps
Last D-item: Argo Rollouts (progressive delivery). (Docs/README + CI badges deferred by the user.)
