# PR #3 Review — Keycloak login + service-enforced RBAC

**Branch:** `feat/keycloak-login-rbac` → `develop`
**Scope:** gateway JWT verify + trusted-header stamp; catalog `RolesGuard` + `@Roles`; shared-tenancy identity headers/interceptor; Keycloak realm; authz-matrix e2e.
**Verdict:** **APPROVE-WITH-NITS.** No critical/blocking RBAC gap. Roles trust and write-route coverage are sound by construction and verified. Findings below are prod-hardening follow-ups + test-coverage gaps; none block merge to `develop`.

Excluded per instructions: network-trust invariant (H2, known backlog); all GREEN gates.

---

## What I verified holds (adversarial pass)

- **RBAC completeness — no escalation.** All 6 catalog write routes carry `@Roles('restaurant-owner','admin')`: restaurants POST/PATCH/DELETE (`restaurants.controller.ts:41,62,72`) and menu-items POST/PATCH/DELETE (`menu-items.controller.ts:41,69,80`). Only 2 controllers exist, no hidden write path (grep confirmed). Guard is global via `APP_GUARD` (`apps/catalog/src/app.module.ts:57`), so a forgotten decorator fails *open*-safe only for reads — every write is decorated. Reads (GET) intentionally undecorated → open to any authenticated tenant. No write is exposed as an unguarded read.
- **RolesGuard logic correct** (`roles.guard.ts:33-54`). Any-of semantics (`required.some(...includes)`), missing role → `ForbiddenException` 403 (`:50-51`), no verified identity (`x-user-id` absent) → `UnauthorizedException` 401 (`:45-46`), no `@Roles` → allow (`:38-40`). Reads roles from the gateway-stamped header, comma-split with trim + empty-filter (`identity-headers.ts:41-49`) — robust to empty/malformed/whitespace. Unit spec covers all four branches (`roles.guard.spec.ts`).
- **Roles cannot be spoofed to catalog.** Forwarder builds the outbound header set from scratch (`http-forwarder.ts:42`), copies only content-type + correlation-id, then stamps identity via `applyTrustedIdentityHeaders` (`:48`), which overwrites `x-tenant-id`/`x-user-id`/`x-roles` from the verified token only (`identity-headers.ts:26-33`). Client-supplied `x-roles`/`x-user-id`/`x-tenant-id` are never copied. Role injection is prevented by construction.
- **Gateway verify** pins RS256, issuer, audience, expiry, clock tolerance (`access-token-verifier.ts:24-31`); iss+JWKS derived from one base URL so they can't drift (`gateway/app.module.ts:26-32`); jose remote JWKS with 10-min cache + 30s cooldown (`jwks-resolver.ts:15-23`). Real-Keycloak e2e (201/403/401) proves aud + `sub` (`basic` scope) + `tenant_id` mappers actually fire — otherwise verify/extract would 401 everything.
- **Fail-closed tenancy.** `extractIdentity` requires `sub` and non-empty `tenant_id` else throws → gateway 401 (`identity.ts:35-44`); interceptor additionally requires a valid UUID tenant else 401 (`trusted-identity.interceptor.ts:40-42`). Spoofed `x-tenant-id` proven ignored (`gateway-identity-edge.e2e-spec.ts:83-112`).

---

## Findings

### HIGH — follow-up before any non-dev environment (NOT a develop-merge blocker)

**H-1. Realm-export is prod-unsafe if promoted as-is** — `infra/keycloak/realm-export.json`
The public SPA client ships with `directAccessGrantsEnabled: true` (`:22`), `redirectUris: ["*"]` (`:26`), `webOrigins: ["*"]` (`:27`), and realm `sslRequired: "none"` (`:4`). This same file is imported by the compose `auth` profile *and* reused verbatim by e2e (`keycloak-container.ts:6`).
- **Scenario:** wildcard `redirectUris` on a public PKCE client enables authorization-code interception / token exfiltration via an attacker-controlled redirect; password grant broadens the credential-stuffing surface; `sslRequired:none` allows token transit in clear.
- All are correctly commented "dev only," so acceptable for the dev artifact this PR adds. **Fix:** ensure the prod realm is a separate artifact (or CI guard) with explicit `redirectUris`/`webOrigins`, `directAccessGrantsEnabled:false`, `sslRequired:external`. Flag so it is not copy-promoted.

### MEDIUM

**M-1. No test locks the anti-role-spoof guarantee** — `apps/gateway-e2e/`
Tenant spoof is tested (`x-tenant-id`), but nothing sends `x-roles: admin` / `x-user-id: …` alongside a *customer* token and asserts 403. Role escalation is the headline risk of this PR; the guarantee currently rests on code inspection of `http-forwarder.ts:42-48`.
- **Fix:** add to authz-matrix: customer token + `.set('x-roles','admin').set('x-user-id','x')` on `POST /restaurants` → expect 403. Cheap regression lock against a future forwarder refactor that copies client headers.

**M-2. `tenant_id` validity is assumed, not enforced at the IdP** (re: focus 4b) — `infra/keycloak/realm-export.json:46-58`
The `tenant_id` mapper emits whatever the user attribute holds; Keycloak does not require it to be present or a UUID. A user provisioned without/with a malformed `tenant_id` yields either gateway 401 (`identity.ts:41`) or catalog 401 (`interceptor:40`) — fail-closed, so not a security hole, but an opaque lock-out with no diagnostic path.
- **Fix:** enforce a required, UUID-formatted `tenant_id` at user provisioning (Keycloak required-attribute / admin automation), and document it as an operational invariant. Not a merge blocker.

**M-3. Menu-item write RBAC never exercised end-to-end** — `apps/gateway-e2e/`
authz-matrix only drives `POST /restaurants`. Menu-item write routes are guarded by identical code + are unit-covered, but no 403/201 e2e proves the nested-route guard fires.
- **Fix:** add one owner-201 + customer-403 case on `POST /restaurants/:id/menu-items`.

### LOW / nits

- **L-1.** No `admin`-role path is tested (no admin user seeded); authz-matrix proves owner+customer only. Consider seeding an admin user + one admin-writes-201 case. `realm-export.json:62-89`.
- **L-2.** No expired-token case in the real-KC matrix (accessTokenLifespan 300s makes it awkward; jose expiry is unit-proven). Optional.
- **L-3.** With `fullScopeAllowed:true` (`realm-export.json:25`) `extractRoles` forwards Keycloak default roles (`offline_access`, `uma_authorization`, `default-roles-food-delivery`) into `x-roles` — harmless but noisy. Not a defect.
- **L-4.** Forwarder response relay copies all upstream headers except 3 (`http-forwarder.ts:74-78`) — could pass through internal/server headers to clients. Not authz; consider an allowlist. Out of PR scope.
- **L-5.** `.env.example` dev creds (`admin/admin`, `keycloak/keycloak`) — expected in an example file; ensure real deployments override. No secret leaked in realm-export (public client, no secret) — good.

---

## Unresolved questions

1. Is there a separate prod Keycloak realm artifact, or is `realm-export.json` intended to be promoted? (drives H-1 severity)
2. Who provisions real users' `tenant_id`, and is UUID validation enforceable there? (drives M-2)
3. Intended handling for a legitimate user hitting the fail-closed 401 due to missing `tenant_id` — silent 401 acceptable, or should the gateway emit a distinguishable error?
