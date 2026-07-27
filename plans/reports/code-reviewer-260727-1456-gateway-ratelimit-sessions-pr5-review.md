# PR #5 Review — Gateway Redis rate-limiting + Keycloak session proxies + global-guard rewiring

**Branch:** `feat/gateway-ratelimit-sessions` → `develop`
**Reviewer:** code-reviewer (adversarial / production-readiness)
**Date:** 2026-07-27

## Verdict: APPROVE WITH REQUIRED CHANGES

No route-exposure regression. The global-guard rewiring is **correct**: only `KeycloakSessionController` is `@Public()`; catalog and auth reverse-proxies stay globally authed; `@Public()` disables Jwt while RateLimit still runs (intentional, documented); guard order (Jwt→RateLimit) is right so `sub` exists before keying. Session security (rotation, backchannel logout, error mapping, no token logging, no open-redirect) is sound. **Two HIGH items must be resolved before merge** — both are edge/availability defects invisible to the green suite because e2e never exercises Redis-down nor a real proxy hop.

---

## HIGH — must fix before merge

### H1. Redis-down = unhandled rejection → HTTP 500 on *every* rate-limited route (whole-gateway outage)
`apps/gateway/src/rate-limit/rate-limit.guard.ts:45` awaits `this.store.hit(...)` with **no try/catch**; `apps/gateway/src/rate-limit/redis-rate-limit-store.ts:28` (`redis.incr`) rejects when Redis is unreachable (`lazyConnect`, `maxRetriesPerRequest:2` → the command fails fast). The rejection propagates to Nest's default filter → **500** on:
- every authenticated catalog/auth proxy request (sub-keyed), AND
- every public session request `/auth/token|refresh|logout` (IP-keyed).

**Scenario:** Redis restarts / network blip / eviction. The limiter is a cross-cutting **edge** concern, so a Redis outage takes the entire gateway offline — including login/refresh, so users cannot even re-authenticate. This is fail-closed-by-crash, not a deliberate policy.

**Fix (pick one, make it explicit + logged):**
- *Fail-open* (typical for edge limiters, preserves availability): wrap `store.hit` in try/catch, `logger.warn` on error, `return true`. Trade-off: limiter silently off during a Redis outage.
- *Fail-closed with a correct status*: return **503 + Retry-After**, never a 500 (a 500 misrepresents a dependency outage as a gateway bug and produces no Retry-After).

Add a unit test asserting the chosen behavior (store.hit rejects → expected outcome).

### H2. `trust proxy` never configured, but the IP-keyed limiter design depends on it
`apps/gateway/src/main.ts` never calls `app.set('trust proxy', …)`, yet `rate-limit.guard.ts:63-67` keys public routes by `request.ip` and its own comment (`:65`) says "Behind a trusted proxy, configure Express `trust proxy`." Deployment is behind Nginx (per PR context). With trust proxy off, `req.ip` = the **Nginx socket IP** for all clients.

**Scenario:** Every public session request platform-wide collapses into a single bucket `rl:ip:<nginx-ip>`. With `RATE_LIMIT_MAX=100 / 60s`, the *entire platform's* logins/refreshes are globally capped at 100/min → legitimate users get collateral **429** under normal load (self-DoS on exactly the auth path). Sub-keyed authenticated routes are unaffected (identity, not IP).

**Second-order trap:** the naive fix `trust proxy: true` makes `X-Forwarded-For` fully spoofable → an unauthenticated caller rotates XFF per request to dodge the IP limit entirely. So the fix must be deliberate.

**Fix:** set `app.set('trust proxy', <hop-count e.g. 1, or the Nginx subnet>)` matching the real topology so `req.ip` is the client's first untrusted hop, and document the required Nginx `X-Forwarded-For` setup. Current state is *safe from spoofing but broken behind a proxy*; do not "fix" it into a spoofable state.

---

## MEDIUM

### M1. e2e never exercises the IP-keyed public-route limiter nor Redis-down
`support/service-harness.ts:71-78`: rate limiting is force-disabled (`RATE_LIMIT_ENABLED='false'`) unless a suite opts in, and only `rate-limit.e2e-spec.ts` opts in — and it only tests the **sub-keyed** trip (authenticated catalog). Consequences:
- The IP fallback path (`rl:ip:*`) that guards the public login endpoints is proven only by a unit test with a stubbed store, never end-to-end.
- No test covers H1 (Redis-down) or H2 (proxy IP). These are precisely the untested edges where the two HIGH defects live.

**Fix:** add a public-route IP-trip e2e (hammer `/auth/token` past `max`, assert 429) and a Redis-down case asserting the H1 policy once chosen.

### M2. Auth-proxy admin path (`/tenants`) route-lock not e2e-proven
`authz-matrix.e2e-spec.ts` proves catalog lock (no-token→401, forged-header ignored, RBAC 403). The auth reverse-proxy (`auth-proxy.controller.ts`) relies on the *same* global guard so it's very likely fine, but there is no e2e asserting `/api/v1/auth/tenants` rejects a missing/invalid token at the gateway. Low-risk gap given shared guard; add one assertion for defense-in-depth.

---

## LOW / nits

- **L1. No health/liveness endpoint.** The gateway exposes no `@Public()` health route; a k8s/LB probe to any real path hits `JwtAuthGuard`→401. Add a `@Public() GET /health` (follow-up, not blocking).
- **L2. Session DTO contract is camelCase.** `token-exchange.request.ts` expects `codeVerifier`/`redirectUri`; with `forbidNonWhitelisted:true` an SPA sending OAuth-style `code_verifier`/`redirect_uri` gets a 400. Intentional (gateway's own JSON API, not raw OAuth) but must be documented for the SPA team.
- **L3. `resolveKey` fallback `request.ip ?? 'unknown'`** (`rate-limit.guard.ts:67`): if `req.ip` is ever undefined, all such callers share `rl:ip:unknown`. Edge-only; acceptable.

---

## Cleared / positive (verified, do not re-investigate)

- **Guard rewiring correct.** Only session controller `@Public()`; catalog/auth proxies globally authed (`app.module.ts:45,51-52`); `authz-matrix` e2e proves catalog no-token→401 + forged-identity-header ignored + RBAC. No route accidentally public; nothing that must stay public is locked (there are simply no reference/Scalar/health routes to lock).
- **No open-redirect.** `redirectUri` is relayed to Keycloak's *token* endpoint (`keycloak-oidc.client.ts:49`), validated by Keycloak against the client's registered redirect URIs; the gateway never issues an HTTP redirect from it. Not exploitable.
- **Upstream error mapping is safe.** `keycloak-oidc.client.ts:84-93` surfaces only the standard OAuth `error` code (invalid_grant→401, else→400); never the raw Keycloak body. `.catch(()=>({}))` guards non-JSON responses.
- **No token logging.** Only `response.status` is logged on logout failure (`:73`); no access/refresh token or code is logged anywhere.
- **Logout is a real backchannel revoke** requiring a non-empty refresh token (`refresh-token.request.ts` `@IsNotEmpty`; client posts to `/logout` with `client_id`+`refresh_token`). e2e proves post-logout reuse→401.
- **Realm rotation config placed correctly** — `revokeRefreshToken:true` + `refreshTokenMaxReuse:0` at realm root (`realm-export.json`); e2e proves rotation invalidates the old token and reuse→401.
- **RateLimitStore self-heals a TTL-less counter** (`redis-rate-limit-store.ts:34-40`) so a crash between INCR/EXPIRE can't lock an identity out permanently. Good.
- **HttpForwarder** rebuilds outbound headers from scratch (drops client Authorization + spoofed identity), 10s abort→504/502 fail-closed. Good.
- **`RATE_LIMIT_ENABLED` string-"false" handling** (`rate-limit.guard.ts:33-34`, schema `:38-41`) correctly avoids the truthy-"false" coercion trap.

---

## Unresolved questions
1. **H1 policy decision is yours:** fail-open (availability) vs fail-closed-503 (strictness)? For an edge limiter guarding login, I lean fail-open + warn — but this is a security/availability trade-off the owner must sign off.
2. **H2:** what is the exact prod proxy topology (single Nginx hop? load balancer + Nginx?) — needed to set the correct `trust proxy` hop count/subnet rather than a blanket `true`.
3. Is a gateway health endpoint expected by the deploy target (k8s probe / LB), or is liveness checked elsewhere? (L1.)
