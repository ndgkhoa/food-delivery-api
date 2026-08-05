# Code Review — Signed Internal Identity (HMAC gateway→service trust)

Branch: `feat/signed-internal-identity` (uncommitted, off `develop`). Reviewed 2026-08-03.
Spec: `plans/260725-2139-food-delivery-microservices/backlog-04a-signed-internal-identity.md`

## Verdict
Core HMAC verify path is correct — **no reachable false-accept found**. The crypto, the
constant-time compare, the skew window, the ts parsing, and the fail-closed-on-throw
behavior are all sound. The real risks are in the *gating* and *scope*, not the MAC:
enforcement silently disappears if the key is unmounted, and the gRPC edge is not covered.

## Scope
- Files: identity-signature.ts (NEW, untracked), identity-headers.ts, trusted-identity.interceptor.ts,
  tenancy.module.ts, index.ts, http-forwarder.ts, env-schema.ts, k8s base/prod, 3 spec files.
- Focus: correctness of an auth-integrity control on a multi-tenant boundary.

## Correctness properties — results
1. No false-accept: PASS. Missing/empty/array headers, non-hex/wrong-length sig, `1e3`/NaN/neg/float ts all rejected. Delimiter-collapse is a non-escalating Low (see F5/F6).
2. No throw-through: PASS. `verify` is pure and cannot throw; even a hypothetical throw propagates as 500 before `tenantContext.run` → denied. Fail-closed.
3. Constant-time: PASS. `timingSafeEqual` is length-guarded via short-circuit OR; no `===` on the MAC.
4. Skew window: PASS. `Math.abs(now-ts) > maxSkewMs` rejects far-future and stale; Infinity ts rejected.
5. Enforcement gating: **FAIL — see F1 (silent fail-open) + F3 (untested).**
6. Non-HTTP transport: **GAP — see F2 (gRPC edge unsigned).**
7. Gateway/service agreement: PASS. Same key via ConfigService, same lowercase header consts, signed `ts` == stamped `ts`, roles join symmetric for normal roles (F5 caveat).
8. K8s: PASS with note. All 12 service Deployments + gateway have an `envFrom` list so `envFrom/-` append is safe; secret is a base64 placeholder (`changeme-dev-only-...`), not a real credential; one shared Secret wired to all.

---

## HIGH

### H1 — Silent fail-open when signing key is unset in a non-test env
`libs/shared/tenancy/src/tenancy.module.ts` (factory) + `identity-signature.ts:63-65`.
`enforced = process.env.NODE_ENV !== 'test' && Boolean(key)`. If `INTERNAL_IDENTITY_SIGNING_KEY`
is unset in prod/dev-serve (Secret fails to mount, env-name typo, key deleted during rotation),
`enforced` is `false` and `verify` returns `{ ok: true }` for **every** request — the entire
control this backlog adds silently vanishes, re-opening the exact cross-tenant/forgery hole it
exists to close. Nothing is logged.
- Scenario: prod Deployment rolls out, the `internal-identity-secret` ref is dropped/renamed → `key===undefined` → all forged-header direct calls accepted, zero signal in logs/metrics.
- Fix: at module construction, when `NODE_ENV !== 'test'` and `!key`, emit a loud `logger.warn`/`logger.error` ("internal identity signature enforcement DISABLED — INTERNAL_IDENTITY_SIGNING_KEY not set") or fail startup. Make the off-state observable. NODE_ENV-unset is safe (enforces when key present); only key-unset is the trap.

### H2 — gRPC edge establishes tenant from UNSIGNED metadata (scope gap vs the stated property)
`apps/catalog/src/interface/grpc/grpc-tenant-context.interceptor.ts:27-45`.
The HTTP interceptor now HMAC-verifies, but the gRPC counterpart runs `tenantContext.run` from a
plain `x-tenant-id` metadata value with no signature check. The spec/success-criteria claim "every
service … a direct-to-service request with forged `x-tenant-id` → 401"; that holds for HTTP only.
- Scenario: caller reaches catalog's gRPC port directly (compromised pod / mis-scoped NetworkPolicy — the exact threat model in the spec §Brief), sets `x-tenant-id` metadata to any valid UUID → full cross-tenant access on the gRPC surface. `roles:[]`/`actor:'system'` means no role-escalation, so cross-tenant read/write only, not privilege-escalation.
- Down-rank note: this is arguably by-design (04a is HTTP-scoped; gRPC deferred to 04b NetworkPolicy). But 04a's whole rationale is defense-in-depth *because* network isolation may fail — so leaving the gRPC ingress on network-trust-only is a real residual. Fix: either sign/verify gRPC metadata with the same HMAC, or explicitly document in the interceptor + spec that the gRPC edge relies solely on 04b and correct the "every service" overclaim.

### H3 — The prod enforcement decision is untested
`tenancy.module.ts` factory. Every verifier test constructs `IdentitySignatureVerifier` directly
with `enforced: true/false`. The one line that decides whether a real deploy enforces —
`NODE_ENV !== 'test' && Boolean(key)` reading `process.env` — has **no test**. A regression here
(e.g. someone flips to `??`, or inverts the NODE_ENV check) ships silently.
- Fix: add a small unit test around the factory / a pure helper extracted from it: (NODE_ENV=production, key set)→enforced; (key unset)→not enforced + warning; (NODE_ENV=test)→not enforced.

---

## MEDIUM

### M1 — Core module files are untracked (`??`), not staged
`identity-signature.ts` and `identity-signature.spec.ts` are untracked in git. `identity-headers.ts`,
`trusted-identity.interceptor.ts`, `tenancy.module.ts`, `index.ts` (all modified) `import` from the
untracked module. A `git commit` that doesn't add them ships a tree that fails to compile / deploys
services importing a non-existent file.
- Fix: `git add libs/shared/tenancy/src/identity-signature.ts libs/shared/tenancy/src/identity-signature.spec.ts` before committing; confirm they land in the same commit as the importers.

---

## LOW

### L1 — Roles sign/verify canonicalization asymmetry (fail-closed, non-escalating)
`identity-signature.ts:23` signs `identity.roles.join(',')`; `verify` (line 75) runs
`parseRolesHeader` (split/trim/filter-empty) then re-joins. For roles containing empty strings,
leading/trailing whitespace, or an embedded `,`, sign and verify diverge → **false-reject** (401),
not false-accept. Also `['a,b']` and `['a','b']` collapse to the same MAC — but the MAC covers the
same lossy wire form the service will act on, so no *new* escalation. Not reachable for normal
Keycloak role slugs. Note: the gateway signs the *raw* array while the service verifies the
*parsed* form — safer would be to sign the exact stamped header string so sign and verify operate
on byte-identical input.

### L2 — Canonical string is delimiter-joined, not length-prefixed/escaped
`identity.tenantId\nsub\nroles\nts`. A `\n` in `sub` could theoretically shift field boundaries so
two distinct identities share a canonical string. Not reachable: `tenantId` is UUID-validated before
`verify`, `sub`/`roles` come from a verified JWT claim. Documented as a latent robustness gap only;
if any of those inputs ever becomes free-form, switch to length-prefixed or JSON-encoded fields.

### L3 — Negative `INTERNAL_IDENTITY_MAX_SKEW_MS` bypasses schema → all-401 DoS
`tenancy.module.ts`: `Number(process.env.INTERNAL_IDENTITY_MAX_SKEW_MS) || DEFAULT` reads raw
`process.env`, bypassing the `.positive()` zod schema. `|| DEFAULT` catches `0`/`NaN` but not a
negative (`"-5"`→-5, truthy) → `Math.abs(...) > -5` always true → every request 401s. Fail-closed
(DoS, not bypass). Fix: clamp `maxSkewMs = n > 0 ? n : DEFAULT`.

### L4 — Far-future ts not unit-tested
Only a stale *past* ts is tested (`NOW - 120_000`). The abs() logic covers far-future, but add a
`NOW + 120_000` reject case for regression safety.

---

## Positive observations
- `timingSafeEqual` correctly length-guarded; no `===` on the MAC anywhere.
- `verify` is pure and cannot throw (hex `Buffer.from` never throws, timingSafeEqual guarded) → fail-closed by construction.
- ts regex `^\d+$` strictly rejects `1e3`/float/negative/NaN before `Number()`.
- `||` vs `??` for skew is deliberate and correct (0/NaN must not collapse the window) — good comment.
- Enforced-but-no-key fails closed (doesn't treat missing key as legacy) — correct and tested.
- K8s: all Deployments already carry an `envFrom` list so the single `envFrom/-` patch is safe across all shapes; committed secret is a clearly-labeled base64 placeholder; single shared Secret object prevents per-service drift.
- Verifier edge-case tests are genuinely good: tamper tenant/roles/ts, stale, missing sig, non-numeric ts, wrong-length sig (timingSafeEqual guard), wrong key.

## Metrics
- New verifier logic: well covered except the process.env gating line (H3).
- Reachable false-accepts: 0.

## Unresolved questions
1. Is catalog's gRPC port (and any other service RPC ingress) reachable independent of the gateway in prod? If yes, H2 is High-with-teeth; if 04b truly isolates it, H2 downgrades to a doc fix. (Business/topology call.)
2. Intended behavior when the key is unset in prod — spec says "never in prod," but should the service **refuse to start** rather than run unenforced (H1)? Recommend fail-fast; confirm.
3. Rotation window: during a key roll, gateway and services briefly disagree → 401s. Is the runbook (noted as 04c-adjacent) tracking a dual-key accept window, or is a brief 401 blip accepted?
