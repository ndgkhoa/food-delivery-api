# Security Review — gRPC signed tenant identity (`feat/grpc-signed-identity`)

Reviewer: code-reviewer · Date: 2026-08-03
Scope: uncommitted diff vs `develop` — HMAC-sign east-west gRPC tenant metadata (order signs; catalog + inventory verify), mirroring the HTTP identity-signature pattern.

## Verdict

**Ship-ready. No Critical/High signature-bypass or fail-open defect found.** The change faithfully mirrors the proven `identity-signature.ts` HTTP pattern, with correct fail-closed ordering, constant-time compare, non-throwing verify, and working domain separation (test-proven). All prod-critical properties hold. Only operational/DRY notes below.

Files reviewed (all changed + wiring):
- NEW `libs/shared/tenancy/src/grpc-identity-signature.ts`
- `libs/shared/tenancy/src/{tenancy.module,index}.ts`
- `apps/order/src/infrastructure/grpc/build-tenant-metadata.ts`
- `apps/catalog/src/interface/grpc/grpc-tenant-context.interceptor.ts`
- `apps/inventory/src/interface/grpc/{read-tenant-from-metadata,inventory.grpc.controller}.ts`
- Wiring verified: `apps/{catalog,inventory}/src/app.module.ts`
- Tests: `libs/shared/tenancy/src/grpc-identity-signature.spec.ts` — 15/15 pass (ran locally).

---

## Checklist against the 6 review asks

### 1. Signature-bypass / verify correctness — PASS
- **Read-once tenantId (no TOCTOU / duplicate-metadata split).** Both consumers read `tenantId` ONCE via `firstMetadataValue(...)[0]` and use that same local for BOTH `verify()` and establishing/returning tenant context (`grpc-tenant-context.interceptor.ts:44` + `:57`; `read-tenant-from-metadata.ts:31` + `:53`). An attacker cannot make the verified value differ from the used value by sending duplicate `x-tenant-id` entries — both sides deterministically take `[0]`.
- **ts validation:** `/^\d+$/` (`grpc-identity-signature.ts:71`) rejects non-numeric, negative (no `-`), float (no `.`), and empty. Good.
- **sig validation:** `Buffer.from(sigValue,'hex')` truncates on non-hex/odd-length rather than throwing; the `expected.length !== actual.length` guard (`:91`) then rejects any buffer that isn't the exact 32 bytes, so non-hex / wrong-length sigs are rejected before `timingSafeEqual`. Test `never throws on a wrong-length signature` covers it.
- **Constant-time compare:** length-guard first, `timingSafeEqual` only on equal-length buffers, no string `===` (`:91`). Correct.
- **tenantId `\n` canonical-collision:** `verify()` itself does not format-check tenantId, BUT both callers gate on `UUID_REGEX` BEFORE calling `verify` (`interceptor.ts:50`, `read-tenant-from-metadata.ts:34`). JS `$` (no `m` flag) matches only true end-of-input, so a trailing/embedded `\n` fails the UUID regex → cannot reach `verify` → cannot inject extra newlines into `grpc\n${tenantId}\n${ts}`. No collision path.
- **Fail closed:** `verify` is pure and never throws (no I/O; `createHmac`/`Buffer.from` don't throw on these inputs). Both callers check `.ok` and throw `RpcException(UNAUTHENTICATED)` BEFORE tenant context is established (interceptor: before the `new Observable` scope; inventory: `readTenantFromMetadata` throws before returning, so the handler never runs). No path trusts unsigned metadata when enforced.

### 2. Domain separation — PASS
gRPC canonical `grpc\n${tenantId}\n${ts}` (`:16`) vs HTTP canonical `${tenantId}\n${sub}\n${roles}\n${ts}`. Distinct fixed `grpc\n` prefix AND different newline/field count (gRPC=2 newlines, HTTP=3). With tenantId constrained to a UUID (no newlines), the two byte-strings cannot be equal, so an HTTP identity MAC can never verify as a gRPC MAC or vice-versa — even though they share one key. Explicitly covered by the `domain separation` test (`spec:99`), which passes.

### 3. Enforcement gate — PASS
Both verifiers derive from the single source of truth `resolveIdentityEnforcement(process.env)` (`tenancy.module.ts` GRPC factory). Under `NODE_ENV=test` → `enforced=false` → `verify` returns `{ok:true}` immediately (legacy unsigned suites stay green). In production without a key → factory THROWS at boot (`identity-signature.ts:165`) → service will not start unprotected. Producer/consumer canonical + metadata-key agreement confirmed: order stamps `x-identity-ts`/`x-identity-sig` and signs `grpc\n${tenantId}\n${ts}`; consumers read the same keys and recompute the same canonical, with `Number(tsValue)` round-tripping losslessly for 13-digit epoch-ms. Producing sig accepted by verifier is proven by `spec:23`.

### 4. DI / bootstrap — PASS (the prior not-exported-token crash is avoided)
`GRPC_TENANT_VERIFIER` is provided AND listed in `exports` of the `@Global TenancyModule` (`tenancy.module.ts` exports array). Catalog injects it in `GrpcTenantContextInterceptor` (registered as a provider in `catalog/app.module.ts:100`, applied via `@UseInterceptors`), inventory injects it in `InventoryGrpcController` (controller of a module importing global `TenancyModule`). Because APP-level interceptors are re-instantiated in each service injector, the export is required — present here. No un-exported-token bootstrap crash.

### 5. Metadata read — PASS
`firstMetadataValue` takes `.get(key)[0]` then `typeof raw === 'string' ? raw : raw?.toString()` — same Buffer/string + first-value handling as the existing tenantId read, and `undefined`-safe. All three keys (`x-tenant-id`, `x-identity-ts`, `x-identity-sig`) are already lowercase, so grpc-js key-lowercasing causes no producer/consumer mismatch. Non-`-bin` keys → string values; the Buffer branch is a harmless safety net.

### 6. No behavior break — PASS
- No key → producer stamps unsigned exactly as before (`build-tenant-metadata.ts` guarded `if (key)`).
- `NODE_ENV=test` → `enforced=false` → context established as before.
- gRPC path never touched roles/actor; `actor: system` comment unchanged.
- All callers updated to the new signatures (`readTenantFromMetadata` 3-arg: both inventory call sites; `buildTenantMetadata` unchanged arity: both order adapters compile). No stale caller.

---

## Findings

### Medium

**M1 — Rolling-deploy window can 5xx order→callee gRPC (fail-closed, not a security hole).**
`build-tenant-metadata.ts` + the enforcement gate couple "key present" with "enforce" — there is no separate enable flag. During the rollout of THIS change, if a new catalog/inventory pod (has key → enforces) starts serving before order's pods are updated (old order code sends unsigned metadata), those calls are rejected `UNAUTHENTICATED`. Direction is safe (rejects, never accepts a forgery) but is an availability risk for the order flow during the deploy window.
- *Fix:* roll out order (producer) to completion before catalog/inventory begin enforcing, OR gate enforcement behind an explicit flag separate from key-presence to allow "sign-first, enforce-later". At minimum, document the deploy ordering in the plan/runbook and inject the shared `INTERNAL_IDENTITY_SIGNING_KEY` Secret to all three services in the same release.
- *Weight:* Medium — self-inflicted outage window only, no data/authz exposure; backstopped by the fact it fails closed.

### Low / Informational

**L1 — `firstMetadataValue` duplicated (DRY).** Identical helper defined in both `grpc-tenant-context.interceptor.ts:24` and `read-tenant-from-metadata.ts:12`, and logically the same as `firstHeaderValue` in `identity-headers.ts`. Consider one shared helper in `shared-tenancy` (or `shared-contracts`) to keep the "take first metadata value" rule single-sourced. Non-blocking.

**L2 — In-window replay is not operation-bound (accepted, matches HTTP design).** The MAC binds `tenant + ts` only, not the RPC method or request body. A captured signed triple can be replayed for any Reserve/Release on that tenant within `maxSkewMs` (default 60s). This mirrors the HTTP identity signature (which also doesn't bind the body) and is backstopped by the NetworkPolicy (only order reaches the gRPC port), so weight is low. No change recommended unless the threat model tightens; if it does, bind a method/request nonce into the canonical.

**L3 — "logged once" comment relies on provider-init ordering.** The GRPC factory re-calls `resolveIdentityEnforcement` and intentionally does not log the dev warning (comment in `tenancy.module.ts`). Correct today because the HTTP factory logs it; harmless coupling, just noting the comment's assumption. No action.

---

## Positive observations
- Read-once tenantId eliminates the duplicate-metadata TOCTOU that would otherwise let verified≠used values diverge.
- Constant-time compare with an explicit length guard; `verify` is genuinely non-throwing → callers can't accidentally leak a throw into the trusted path.
- Fail-closed ordering: rejection happens before tenant context is ever established, in BOTH consumers.
- Domain separation is real AND has a dedicated passing test replaying an HTTP sig as gRPC.
- Enforcement reuses `resolveIdentityEnforcement` — single prod-critical gate, not re-implemented.
- DI export corrected (`GRPC_TENANT_VERIFIER` in `exports`), avoiding the previously-seen un-exported-token bootstrap crash.
- Strong spec coverage: tamper/tenant, tamper/ts, stale + future replay, missing sig/ts/tenant, wrong key, wrong-length sig, domain separation, not-enforced passthrough, enforced-without-key fail-closed. 15/15 pass.

## Metrics
- New verify logic: unit-covered (15 cases). Consumer interceptor/controller wiring: covered indirectly (no new dedicated interceptor spec — see Q1).
- Lint/type: no stale callers; signatures updated at all call sites.

## Unresolved questions
1. Is there an integration/e2e that exercises catalog interceptor + inventory controller UNDER enforcement (`enforced=true`) end-to-end (signed metadata accepted, forged/absent rejected via the real gRPC path)? Unit tests cover the verifier; a thin enforced-path integration test would close the interceptor/controller gap. (Consistent with the known "gateway/service HTTP proxy path" testing-gap pattern — the gRPC verify path deserves the same smoke coverage.)
2. Confirm compose-based e2e run with `NODE_ENV` != `test` also set `INTERNAL_IDENTITY_SIGNING_KEY` for all three services, else those envs will now enforce and reject unsigned traffic (same as the existing HTTP verifier requirement — verify parity).
