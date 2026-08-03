# Fix — runtime image HIGH/CRITICAL CVEs (CD image-scan green)

Context: [plan.md](./plan.md) · [phase-08c-a-k8s-manifests-dockerfiles.md](./phase-08c-a-k8s-manifests-dockerfiles.md) · [phase-08d-cicd-github-actions.md](./phase-08d-cicd-github-actions.md)

## Overview
- **Priority**: security maintenance — user-prioritized ahead of the last D-item.
- **Status**: ✅ Verified live (distroless refactor) — branch `fix/runtime-image-base-cve`. Awaiting review/merge.
  - **User chose the distroless approach** (over patch+ignore) — the root-cause fix.
  - **Implemented + verified**: refactored `infra/docker/Dockerfile` to a 3-stage build — `builder` (node-slim, nx build) → `deps` (node-slim, `npm install` the pruned prod deps so native modules fetch on matching glibc/arch) → **`runtime` = `gcr.io/distroless/nodejs24-debian12:nonroot`**. Result on a real build+scan of `order` (kafka native) and `media` (sharp/libvips native): **28 → 0 unignored HIGH/CRITICAL**. Distroless removed ~22 base CVEs (perl/gzip/util-linux/zlib/ncurses/gnutls + the npm install-tooling that came with slim); a deps-stage `npm pkg set overrides.js-yaml` fixed the 1 remaining node HIGH (GHSA-pm4m-ph32-ghv5, a @nestjs/swagger transitive); the only ignores are 6 `libssl3` CVEs (see below). Both images **boot** (Nest starts, native kafka/pg/sharp modules load; they fail only on missing env — expected). Image is tiny (**89.6MB**). hadolint + actionlint clean.
  - **Adversarial review + fixes** (report `reports/code-reviewer-260803-distroless-runtime-cve-fix-review-report.md`; sound root-cause fix, no diff-level blocker — findings were coverage + one override issue):
    - **H1 (payment/Temporal untested — Rust native addon)**: boot-tested `payment` on distroless — the `@temporalio/core-bridge` Rust `.node` loads + Nest bootstraps (fails only on env). All three distinct native ABIs now verified (C++ kafka `order`, C++ sharp/libvips `media`, **Rust** temporal `payment`); the other 10 services add no new native ABI.
    - **H2 (override unbounded above) + H3 (override global)**: the advisory affects only js-yaml `5.0.0-5.2.1`, so kafka-javascript's `4.3.0` is NOT vulnerable — the global `>=5.2.2` needlessly majored it. **Fixed**: SCOPED the override to `@nestjs/swagger` and PINNED it exactly to `5.2.3` (verified published), so it can't drift to a future major or touch kafka's 4.3.0.
    - **M1 (native-module TLS libs)**: reworded the trivyignore justification — the kafka client is PLAINTEXT (no SASL_SSL, grep-confirmed) so librdkafka never exercises system libssl3; noted that a future SASL_SSL broker would also need libsasl2 (absent in distroless), tracked separately.
    - **M2 (read-only fs writes)**: the three boot-tests reach Nest bootstrap without an fs-write crash; Temporal's bundler is in-memory. Confirmed correct by the review: `CMD ["main.js"]`, no shell/RUN in the distroless stage, glibc→glibc ABI, uid-1000 reads world-readable files, TEMPORAL_WORKFLOWS_PATH preserved, 6 exact CVE IDs (no future-CVE masking).
  - **The 6 justified ignores** (`infra/docker/.trivyignore`, wired into the CD image-scan via `trivyignores`): system `libssl3` CVEs. Node uses its OWN bundled OpenSSL (verified `process.versions.openssl = 3.5.5`), never the system `libssl3.so`, so they're present-but-unused; the fix (`deb12u2`) exists upstream but hasn't landed in a distroless rebuild yet (no apt in distroless to patch in-image) — Renovate-tracked, clears on the next base bump. NOT a blanket allowlist — every fixable CVE was fixed, not ignored.
- **Brief**: The CD `trivy image scan` job (blocks on HIGH/CRITICAL) has been **red on every recent develop CD run** — surfaced while verifying D3 (its `build-push` signing jobs are green; the scan is a separate `needs:` job). The 13 runtime images share `node:24.14-slim` (debian-12). A full scan of the CD-built `order` image (authoritative) found **28 unique HIGH/CRITICAL**, all in the OS layer + a few npm transitive deps; **the app's own node deps are clean**. Fix the FIXABLE ones and justify-ignore only the genuinely unfixable — do NOT blanket-ignore fixable CVEs.

## CVE categorization (from `trivy image --severity HIGH,CRITICAL` on the built order image)
**A. Fixable — debian (an `apt-get upgrade` in the runtime pulls the patched packages):**
- `libgnutls30` → deb12u7: CVE-2026-42010 (C), CVE-2026-33845 (C), CVE-2026-42009 (H), CVE-2026-3833 (H), CVE-2026-33846 (H)
- `libcap2` → 1:2.66-4+deb12u3: CVE-2026-4878 (H)

**B. Fixable — npm transitive (bump via pnpm overrides to the fixed version):**
- `tar` → 7.5.19: CVE-2026-59873 (C), CVE-2026-59874/31802/29786 (H)
- `sigstore` → 4.1.1: CVE-2026-48815 (H)
- `minimatch`: CVE-2026-27904/27903 (H) · `brace-expansion`: CVE-2026-13149 (H) · `picomatch` → 4.0.4: CVE-2026-33671 (H)
- (These arrive via a native module's `@mapbox/node-pre-gyp` build tooling that lands in prod `node_modules`; the developer confirms the dep path and bumps the smallest safe set — override the leaf versions, or bump/prune the parent — then verifies the native install still works.)

**C. Unfixable — justify-ignore (no fixed version: `fix_deferred`/`affected`/`will_not_fix`), image-scoped:**
- `perl-base`: CVE-2026-42496 (C), CVE-2026-57433 (C), CVE-2026-8376 (C), CVE-2026-13221 (C), CVE-2026-9538/57432/48962/42497 (H)
- `zlib1g`: CVE-2023-45853 (C — minizip `zipOpenNewFileInZip4_6`, debian `will_not_fix`)
- `libtinfo6`: CVE-2025-69720 (H) · `libacl1`: CVE-2026-54369 (H) · `gzip`: CVE-2026-41992 (H) · `bsdutils`: CVE-2026-53615 (H)
- **Justification** (real threat model): the services run `node main.js` and never invoke perl, tar/gzip/minizip extraction, blkid, or terminfo on attacker-controlled input — these packages are inert base-image transitive deps, not part of the running attack surface. Ignore with a per-CVE reason; revisit when debian ships a fix (trivy `exp:` expiry where useful).

## Design
- **A** — Dockerfile runtime stage: `apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*` (security patches only; keep the layer clean). Verify no size/behaviour regression.
- **B** — root `package.json` `pnpm.overrides` (or the repo's existing override mechanism) forcing the fixed versions; rebuild + confirm the native module still installs and the service boots.
- **C** — a NEW image-scoped ignore file `infra/docker/.trivyignore` listing ONLY the unfixable CVE IDs with a one-line justification each; wire the CD `image-scan` step's `trivyignores:` input to it (the repo-root `.trivyignore` is dev-only per the existing cd.yml comment — keep them separate).
- Keep the CD image-scan otherwise unchanged (still blocks on HIGH/CRITICAL — the ignore file only suppresses the documented-unfixable set).

## Related files
- `infra/docker/Dockerfile` (runtime `apt-get upgrade`), root `package.json` (pnpm overrides), NEW `infra/docker/.trivyignore`, `.github/workflows/cd.yml` (image-scan `trivyignores`).

## Todo (distroless approach — chosen over patch+ignore)
- [x] Dockerfile: 3-stage build with a distroless runtime (removes ~22 base CVEs at the root)
- [x] deps-stage `js-yaml` override fixes the one remaining fixable node HIGH (GHSA-pm4m-ph32-ghv5)
- [x] `infra/docker/.trivyignore` (6 unused-libssl3 only, justified) + wired into cd.yml image-scan `trivyignores`
- [x] verify: built + scanned order (kafka) AND media (sharp) → 0 unignored HIGH/CRITICAL; both boot; hadolint/actionlint clean
- [x] plan updated before push

## Success criteria
- A locally rebuilt image scanned with `trivy image --severity HIGH,CRITICAL` (using the image-scoped ignore) reports **0** findings → the CD image-scan job goes green.
- Every FIXABLE CVE is actually fixed (not ignored); the ignore file contains ONLY unfixable CVEs, each justified.
- All 13 services still build and boot (the runtime `pg` install + Temporal workflows path + entrypoint unchanged).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| pnpm override breaks a native module's install | M×H | Override the minimal set; rebuild + boot-test; fall back to parent-bump or (if truly incompatible + non-runtime-invoked) justify-ignore that specific leaf |
| `apt-get upgrade` bloats/destabilizes the image | L×M | Security upgrade only + clean apt lists; rebuild + boot-test; pinned base tag unchanged |
| Ignoring a CVE that later gets a fix lingers | L×L | Ignore file is unfixable-only + justified; revisit on Renovate base bumps; optional `exp:` dates |
| Distroless would be cleaner but is a bigger refactor | — | Noted as a follow-up (moves npm install to builder, no shell/perl/tar in runtime) — out of scope for this fix |

## Security considerations
- Fixes real HIGH/CRITICAL (2 gnutls CRITICAL, tar CRITICAL) rather than suppressing them. Only genuinely-unfixable base CVEs are ignored, each with a written, threat-model-based justification — not a blanket allowlist.

## Next steps
Return to the last D-item — Argo Rollouts — after the CD image-scan is green.
