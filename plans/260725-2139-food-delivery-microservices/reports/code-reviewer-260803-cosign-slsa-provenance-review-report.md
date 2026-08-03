# Code Review — cosign keyless signing + SLSA provenance (CD)

Branch: `feat/cosign-slsa-provenance` · File: `.github/workflows/cd.yml` (uncommitted vs `develop`)
Spec: `plans/260725-2139-food-delivery-microservices/backlog-d3-cosign-slsa-provenance.md`

## Scope
- 1 file, ~45 added lines in the `build-push` matrix job (13 apps).
- Focus: keyless flow correctness, verify-identity correctness, supply-chain safety, ordering/gating, version pinning.
- CD is post-merge only (`push: [main, develop]`); self-verifies on first develop run.

## Overall assessment
Solid, correct, and unusually well-commented. The core supply-chain invariant the user cares about **holds**: a broken signing/verify config **cannot** ship a "signed" image while reporting success, and it **cannot** promote to prod. No Critical or High findings. All findings are hardening / defense-in-depth. The verified specifics:

- Permissions `id-token: write` + `attestations: write` + `packages: write` (+ inherited `contents: read`) are the correct and sufficient set for keyless cosign **and** `attest-build-provenance` push-to-registry. `id-token: write` is scoped to `build-push` only; workflow default stays `contents: read`. Correct (cd.yml:34-41).
- Sign/attest **by digest** (`steps.build.outputs.digest`) is correct. `docker/build-push-action@v6` does emit `digest` (output present in the action; only populated on `push`/export — here `push: true`). One manifest digest covers every tag, so signing the digest signs sha/branch/latest. Correct (cd.yml:114, 115, 123).
- `attest-build-provenance@v4` `subject-digest` expects `sha256:<hex>`; the build `digest` output is exactly that form. `subject-name` is the untagged repo path (`ghcr.io/ndgkhoa/<app>`), which is what push-to-registry requires. Correct (cd.yml:122-124).
- Self-verify identity: SAN for a **top-level** (non-reusable) GH Actions workflow is `https://github.com/<owner>/<repo>/.github/workflows/cd.yml@<ref>`. Confirmed `cd.yml` is top-level (no `workflow_call`, not referenced by any other workflow), so the `…/cd.yml@.*` shape + issuer `https://token.actions.githubusercontent.com` is the right identity. Correct (cd.yml:141-142).
- Ordering: build+push → sign → attest → verify. `run` steps carry implicit `if: success()`, so a failed sign aborts the leg before attest/verify; a failed attest aborts before verify. Any non-zero step fails that matrix leg's job (`fail-fast: false` only isolates *sibling* legs, not steps within a leg). Correct.
- Gating: `image-scan needs: build-push`, `deploy needs: [build-push, image-scan]`. If ANY build-push leg fails (incl. sign/attest/verify), the `build-push` job is failed → `image-scan` skipped → `deploy` skipped. So a failed sign/verify on any one app blocks the entire prod promotion (all-or-nothing, safe). Correct.
- No token/secret leak in the added steps: `IMAGE`/`DIGEST` via `env:`, no secret echoed; keyless uses the short-lived OIDC token (never printed). Signing the digest (immutable) not a mutable tag is the right call. Correct.

Answering the two failure modes the user weighted heaviest:
- (a) "ship unverifiable/unsigned image while claiming success" — **prevented**: self-verify + step-failure semantics + needs-gating.
- (c) "break the CD run" — **no** breakage identified; the flow is internally consistent.
- (b) "verify falsely pass/fail" — one theoretical false-*pass* vector (unanchored regex, M1 below); no false-*fail* vector found.

## Findings

### Medium
**M1 — Self-verify identity regexp is unanchored and dot-unescaped (defense-in-depth on the security control).** `cd.yml:141` (and the mirrored consumer example at `cd.yml:131`).
- Concrete: `--certificate-identity-regexp "https://github.com/${{ github.repository }}/.github/workflows/cd.yml@.*"`. cosign matches with Go `regexp.MatchString`, which is **unanchored** (matches a substring), and `.` matches any char. On this specific control the practical exploitability is very low — a false accept requires a Fulcio-issued cert (issuer is pinned to GitHub OIDC) whose SAN *contains* the full literal `https://github.com/ndgkhoa/food-delivery-api/.github/workflows/cd.yml@`, which only this repo's workflow produces. But for a verification control, "practically safe" is weaker than "provably scoped."
- Fix: anchor and escape, and (safe here, since CD only runs on push to main/develop) scope the ref:
  ```
  --certificate-identity-regexp "^https://github\.com/${{ github.repository }}/\.github/workflows/cd\.yml@refs/heads/(main|develop)$"
  ```
  Apply the same to the consumer example comment. If you prefer to keep ref-flexibility, at minimum anchor: `^https://github\.com/…/cd\.yml@.*$`.
- Rank rationale: it's the correctness of the identity gate (a security control), hence Medium, but I explicitly note real-world exploitability is near-zero given the pinned issuer.

### Low
**L1 — Duplicate/implicit BuildKit provenance alongside the explicit SLSA attestation.** `cd.yml:87-99` (no `provenance:` set) + `cd.yml:119-124`.
- Concrete: `docker/build-push-action@v6` enables BuildKit provenance (`mode=min`) by default on registry pushes, turning the pushed artifact into an OCI image **index** with an attestation manifest. You then also attach a full SLSA predicate via `attest-build-provenance`. Not breaking (GHCR, cosign-by-digest, and trivy-by-tag all handle the index), but you end up with two provenance sources of differing fidelity, and the "image" is an index even for a single platform. Consumers using `gh attestation verify` see the `attest-build-provenance` one; tooling reading BuildKit provenance sees the `mode=min` one.
- Fix (pick one): set `provenance: false` in the build step to make `attest-build-provenance` the single source of truth (also yields a simpler single-manifest image), OR set `provenance: mode=max` and drop `attest-build-provenance` if you'd rather keep it in-BuildKit. The spec explicitly wants `attest-build-provenance`, so `provenance: false` is the cleaner match.

**L2 — cosign version is only implicitly pinned via the installer.** `cd.yml:103-104`.
- Concrete: `sigstore/cosign-installer@v4.1.2` installs the installer's *default* cosign release, not a version you pin. Exact-pinning the installer (correct — no `@v4` moving tag exists) pins cosign only transitively. A future installer patch could change the bundled cosign default.
- Fix (optional): add `with: { cosign-release: 'v2.x.y' }` for a fully reproducible cosign binary. Renovate can track it. Low because keyless behavior is stable across cosign v2.x.

**L3 — `${{ github.repository }}` interpolated directly into the verify `run` script.** `cd.yml:141`.
- Concrete: `IMAGE`/`DIGEST` are correctly passed via `env:`, but `github.repository` is templated straight into the shell. `github.repository` has a constrained charset (`owner/repo`) and is not attacker-controllable, so this is not an injection risk today — it's a consistency nit against the workflow's own good pattern (and the repo's "no shell interpolation of refs" convention noted at cd.yml:73).
- Fix (optional): pass it as `env: REPO: ${{ github.repository }}` and reference `$REPO` in the regexp.

## Non-findings (checked, OK)
- `packages: write` correctly retained: cosign pushes the `.sig` and `attest-build-provenance` pushes the referrer using the docker-login credentials (GITHUB_TOKEN), which need packages:write.
- `--yes` is the correct non-interactive flag for cosign v2; no `COSIGN_EXPERIMENTAL` needed (keyless is default in v2).
- 13 parallel signs+attests are well within Sigstore public-good rate limits.
- `attest-build-provenance@v4` moving major tag is consistent with the repo's action-pinning convention (`@v4/@v3/@v6` elsewhere) and is a first-party GitHub action; acceptable. (SHA-pinning all actions would be stricter but is out of scope and inconsistent with the existing repo posture — not raised as a finding.)
- Image is pushed (push:true) before signing — unavoidable when signing by digest; the unsigned-in-GHCR window is covered by the needs-gating (that sha never deploys unless the whole job, incl. verify, is green). Acceptable and documented.

## Recommended actions (priority order)
1. M1 — anchor + escape (+ optionally ref-scope) the verify regexp; mirror in the consumer-example comment.
2. L1 — set `provenance: false` in the build step so `attest-build-provenance` is the single provenance source.
3. L2 / L3 — optional: pin `cosign-release`; move `github.repository` into `env`.

## Metrics
- YAML/actionlint: passes (per spec; not re-run here — no mutations).
- Findings: Critical 0 · High 0 · Medium 1 · Low 3.

## Unresolved questions
- Confirm `github.repository` resolves to `ndgkhoa/food-delivery-api` at runtime (comments assume `ndgkhoa`); if the repo were ever forked/renamed, M1's ref-scoping note still holds since the regexp derives from `github.repository`.
- Post-merge only: verify on the first `develop` CD run (via `gh run`) that `steps.build.outputs.digest` is populated and all 13 self-verifies pass — the one thing this static review cannot exercise.
