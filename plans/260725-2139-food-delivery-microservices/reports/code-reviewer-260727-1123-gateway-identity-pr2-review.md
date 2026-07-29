# PR #2 Review — Auth/Gateway Identity Edge (`feat/auth-gateway-identity` → `develop`)

**Reviewer:** code-reviewer (adversarial / security layer)
**Date:** 2026-07-27
**Diff:** `git diff origin/develop...feat/auth-gateway-identity` (81 files, +1779/-158)

## Merge Verdict: **APPROVE WITH NITS**

The crux — the client-header trust boundary — is implemented correctly and by the *strongest* pattern (outbound headers built from an allowlist, never copied from the inbound request), and the e2e proves a spoofed `x-tenant-id` is ignored. I found **no currently-exploitable security hole**. Two items are worth addressing (one a 1-line hardening, one a deployment invariant to document); the rest are follow-ups/nits. Nothing here blocks merge to `develop`, but see HIGH-1 (cheap, recommend doing now) and HIGH-2 (must document before any prod/staging deploy).

---

## Findings (ranked)

### HIGH-1 — JWT algorithm not pinned (`algorithms` omitted) — recommend before merge (cheap)
`libs/shared/auth/src/access-token-verifier.ts:24-28` — `jwtVerify(token, keyResolver, { issuer, audience, clockTolerance })` passes **no `algorithms`** allowlist.

Evidence / honest severity: this is **not currently exploitable** with the current stack:
- jose v5 never accepts `alg:none` in `jwtVerify` (throws regardless).
- HS/RS confusion is blocked because `createRemoteJWKSet` yields asymmetric public `KeyObject`s and jose's key-type check rejects HMAC algs against them; additionally Keycloak JWKS entries carry `alg`/`use`, so jose constrains key selection.

But it is a real defense-in-depth gap on the trust boundary and violates OWASP/jose guidance. It leaves the service exposed to alg-downgrade/confusion the day a JWKS is served without `alg`, or an EC/PS key sneaks in. Fix is one line and free:
```ts
const { payload } = await jwtVerify(token, deps.keyResolver, {
  issuer: deps.issuer,
  audience: deps.audience,
  algorithms: ['RS256'],           // pin to the IdP's signing alg
  clockTolerance: deps.clockToleranceSec ?? 5,
});
```
Since this is the security library and the change is trivial, recommend landing it in this PR. **Must-fix-before-merge (soft).**

### HIGH-2 — Downstream trust model depends on network isolation that is not enforced/documented — follow-up, must document before prod
`apps/catalog/src/app.module.ts:52` registers `TrustedIdentityInterceptor`, which trusts `x-tenant-id`/`x-user-id` **on authenticity alone from the network** — it only checks UUID *shape* (`trusted-identity.interceptor.ts:38`), not that the request actually came from the gateway. Catalog runs on the host (`app.listen(port)` → binds `0.0.0.0`), and `infra/docker-compose.yml` only fronts the **gateway** with nginx (catalog is not in compose at all).

Exploit: anyone able to reach catalog's port directly (`:3001`) can send `x-tenant-id: <any-uuid>` and read/write **any tenant's** data, completely bypassing JWT verification. The entire boundary is only as strong as "catalog is unreachable except via the gateway", and nothing in this PR enforces that (no network segmentation, no mTLS, no shared gateway↔catalog secret).

For a `develop` merge with no prod deploy this is acceptable, but it must be an explicit, tracked deployment invariant. Follow-up options: private network / no published catalog port, or a gateway-signed header / mTLS between gateway and catalog. **Follow-up (portfolio backlog) + document the invariant now.**

### MEDIUM-1 — Forwarder has no timeout and no error handling around `fetch`
`apps/gateway/src/proxy/http-forwarder.ts:53` — `const upstream = await fetch(targetUrl, init)` with no `AbortController`/timeout and no try/catch.
- Catalog hang → gateway request hangs indefinitely → connection/resource exhaustion (DoS).
- Catalog unreachable (`ECONNREFUSED`) → `fetch` rejects → unhandled → Nest returns generic 500. Not a security bypass (fails closed, no stack leak with Nest's default filter), but it should be a 502/504 and be bounded. Add an `AbortSignal.timeout(...)` and map network failures to `BadGatewayException`/`GatewayTimeoutException`. **Follow-up.**

### MEDIUM-2 — No negative test for `alg:none` / algorithm confusion
`libs/shared/auth/src/access-token-verifier.spec.ts` covers bad-signature, expired, wrong-issuer, wrong-audience (good), but there is **no test asserting an `alg:none` or `alg:HS256`-with-public-key token is rejected** — precisely the claim a JWT security layer should prove. `test-jwks.ts` can only mint RS256. Add a helper to forge an unsigned/`none` token and an HS256 token signed with the public JWK, and assert rejection. Pairs with HIGH-1. **Follow-up (do alongside HIGH-1).**

### LOW-1 — `stripClientIdentityHeaders` is dead code; doc/impl mismatch
`libs/shared/tenancy/src/identity-headers.ts:25` and the PR design narrative describe a "strip inbound → stamp verified" flow, but the forwarder never calls `stripClientIdentityHeaders` — it builds the outbound header set from scratch (`http-forwarder.ts:40-46`), which is *safer* (allowlist beats denylist). Net: the function is unused in production paths. Either delete it (KISS) or keep it as a documented defense-in-depth utility, but update the comment on `identity-headers.ts:8-9` so it doesn't imply a strip step that doesn't run. Not a security issue — the allowlist makes header case/duplicate/underscore smuggling structurally impossible. **Nit.**

### LOW-2 — Gateway accepts any non-empty `tenant_id`; catalog requires a UUID
`libs/shared/auth/src/identity.ts:40-43` only checks `tenant_id` is a non-empty string, while the downstream interceptor requires a strict v1–5 UUID (`trusted-identity.interceptor.ts:14,38`). A token whose `tenant_id` claim is a non-UUID (plausible depending on how Keycloak is configured to emit the claim) passes the gateway, gets stamped, then 401s at catalog. Fails closed (fine), but the coupling assumption "IdP emits `tenant_id` as a UUID" is unvalidated (no Keycloak yet). Validate when wiring Keycloak, or align the gateway's claim validation with the interceptor's. **Informational.**

### LOW-3 — AuthN present, AuthZ/RBAC absent (by design this phase)
Any valid token grants full tenant-scoped catalog CRUD. `roles` is extracted and stamped as `x-roles` (`http-forwarder.ts:46`) but nothing downstream consumes it — the interceptor reads only tenant + actor. nginx's header comment claims "JWT/RBAC/rate-limit live in the gateway", but no RBAC or rate-limiting exists yet. Confirm this is deferred to a later phase; flagging so it isn't silently assumed done. **Informational.**

### LOW-4 — Nginx TLS + response-header hygiene
- `infra/nginx/nginx.conf:56` sets `ssl_protocols TLSv1.2 TLSv1.3` (good) but no `ssl_ciphers`/`ssl_prefer_server_ciphers`, no HSTS. Fine for local self-signed dev; harden before prod. **Follow-up.**
- `http-forwarder.ts:56-60` copies **all** upstream response headers except 3 hop-by-hop ones. Catalog doesn't currently set cookies/identity in responses so no leak today, but an allowlist (or explicit strip of `set-cookie`, `server`, `x-powered-by`) would be safer as catalog grows. **Nit.**

---

## Positive observations (verified, not re-litigating GREEN gates)

- **Header trust boundary is correct and provable.** Forwarder builds outbound headers from scratch (`http-forwarder.ts:40`), never copies inbound `Authorization` or client identity headers → case-insensitive/duplicate/underscore smuggling is structurally impossible, not just filtered. e2e `gateway-identity-edge.e2e-spec.ts:76-101` proves a spoofed `x-tenant-id` is ignored and the token claim wins.
- **Fail-closed everywhere I traced.** Missing/malformed bearer → 401 (`jwt-auth.guard.ts:31-39`, catches *all* verify errors incl. `MissingIdentityClaimError`); missing/invalid trusted tenant → 401 (`trusted-identity.interceptor.ts:38`). Guard is applied at controller level to the `@All('*path')` route (`catalog-proxy.controller.ts:13,17`) — no un-guarded proxied route.
- **Reverse-proxy target is fixed** from `CATALOG_SERVICE_URL` config; `suffix` only contributes to the path, host/scheme are fixed, so no SSRF/open-proxy via path injection.
- **ALS tenant propagation is the correct pattern** (`trusted-identity.interceptor.ts:44-48` subscribes inside `storage.run`) and is empirically confirmed by the passing tenant-isolation e2e.
- **No secrets committed.** `git ls-files` shows only `infra/nginx/certs/.gitkeep`; `.gitignore` correctly ignores `infra/nginx/certs/*`. No `.key/.pem/.crt/.pfx` tracked anywhere.
- **jose pinned `^5.10.0`** per the CJS/ESM constraint; JWKS resolver uses in-memory cache + cooldown (`jwks-resolver.ts`) — sane rotation behavior (unknown-`kid` triggers rate-limited refetch).
- **Sane defaults:** clock tolerance 5s; env schema validates JWKS/issuer/audience as URLs (`gateway-env-schema.ts`).

---

## Unresolved questions

1. Is catalog network isolation (HIGH-2) planned for a specific later phase, or should a gateway↔catalog auth mechanism (mTLS / signed header) be added now? Current model is safe only under an unenforced network assumption.
2. Will the IdP (Keycloak) emit `tenant_id` as a strict UUID? The catalog interceptor hard-requires it (LOW-2); needs confirmation when Keycloak is wired.
3. Are RBAC and rate-limiting (referenced in the nginx comment) scheduled for a defined later phase (LOW-3)?
