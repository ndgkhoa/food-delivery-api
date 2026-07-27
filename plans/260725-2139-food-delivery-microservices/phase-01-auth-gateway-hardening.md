# Phase 1 — Auth & Gateway hardening

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P0 (security foundation for all writes)
- **Status**: ✅ Done — delivered across PR #2 (identity edge), #3 (Keycloak + RBAC), #4 (auth service), #5 (rate-limit + sessions). All merged to develop.
- **Brief**: Introduce Keycloak as IdP. Gateway verifies JWT, enforces RBAC, versioning, rate limiting, validation. Refresh tokens + sessions. Multi-tenant now sourced from token claims. Catalog writes become auth-guarded.
- **Slicing** (too big for one PR):
  - **Slice A — identity edge** ✅ (PR #2, open): gateway app + Nginx L7 (from P0), `shared/auth` (JWKS + JWT verify + claim extractor), `JwtAuthGuard` + URI versioning + ValidationPipe + reverse-proxy, `shared/tenancy` reads `tenant_id` from verified token (drop P0 header-trust), OpenAPI + Scalar (from P0). Verify tested with signed test JWTs — **no Keycloak yet**. → verified-identity requests reach catalog.
  - **Slice B1 — Keycloak + RBAC** (in progress): Keycloak realm/clients/roles + `auth` compose profile; gateway verifies REAL Keycloak tokens; RBAC (`RolesGuard` + `@Roles`) enforced at the service on catalog writes (reads trusted roles header); authz-matrix e2e with real Keycloak tokens.
  - **Slice B2a — auth service** (in progress): `auth` service (tenant registry + user↔tenant map + provisioning admin API) + Keycloak admin-client wrapper (create user + set validated `tenant_id` UUID — addresses review M-2).
  - **Slice B2b — gateway sessions + rate limit**: Redis rate limiting, refresh-token rotation + logout/session revoke, full Authorization Code + PKCE login.
  - Decision (locked): single Keycloak realm + `tenant_id` claim (NOT realm-per-tenant).

## Key insights
- Keycloak does the heavy lifting (OIDC/OAuth2, refresh, session, user store) — don't hand-roll auth. The `auth` service is a thin adapter + tenant registry, not a token issuer.
- Gateway verifies JWT via Keycloak JWKS (offline verification, cache keys). Services trust gateway-validated identity passed in gRPC/REST context — but still defense-in-depth check audience/tenant.
- Tenant = Keycloak realm OR a `tenant_id` claim. Choose claim-based (single realm, `tenant_id` claim) for simplicity; document realm-per-tenant as an alternative.

## Requirements
**Functional**: login (Authorization Code + PKCE), refresh token rotation, logout/session revoke, role assignment (admin/restaurant-owner/customer/driver), RBAC on catalog writes, API versioning (`/api/v1`), per-identity rate limit.
**Non-functional**: JWKS cached; token verify <5ms; rate limiter backed by Redis; all denials audit-logged; correlation ID carries `sub` + `tenant_id`.

## Architecture
- Flow: client → Keycloak (login) → tokens; client → Nginx → gateway (verify JWT via JWKS, extract `sub`/`roles`/`tenant_id` → correlation context) → service.
- Gateway guards: `JwtAuthGuard`, `RolesGuard`, `RateLimitGuard`, `ValidationPipe`, versioning via URI.
- `auth` service: tenant registry (Postgres), maps Keycloak users→tenant, admin endpoints to provision tenants.
- `shared/tenancy` upgraded: reads `tenant_id` from verified token context (drop P0 header-trust).

## Related code files (to create)
- `apps/auth/*` — tenant registry, Keycloak admin client wrapper
- `apps/gateway/guards/{jwt,roles,rate-limit}.guard.ts`, `apps/gateway/*` versioning + validation config
- `libs/shared/tenancy/*` (token-claim source), `libs/shared/auth/*` (JWKS verify, claim types)
- `infra/keycloak/*` realm export (roles, clients, PKCE), compose `auth` profile
- Migration: `tenants`, `user_tenant_map`

## Implementation steps
1. Add Keycloak 26.7 + its Postgres under `auth` compose profile; import realm with clients (public SPA + confidential gateway) and roles.
2. `shared/auth`: JWKS fetch+cache, JWT verify (issuer/audience/exp), claim extractor.
3. Gateway: JwtAuthGuard (verify), RolesGuard (RBAC), URI versioning, global ValidationPipe, Redis-backed rate limiter, refresh-proxy endpoints.
4. `auth` service: tenant CRUD + user↔tenant mapping; tenant provisioning admin API.
5. Upgrade `shared/tenancy` to read `tenant_id` from token; remove header-trust path.
6. Protect catalog writes with roles (restaurant-owner/admin); reads stay public or customer-scoped.
7. E2E: login → get token → create restaurant (allowed) vs customer token (403); refresh rotation; rate-limit trips.

## Todo
**Slice A — identity edge (PR #2 ✅ MERGED):**  *(Keycloak split out to Slice B — verify tested with signed test JWTs)*
- [x] Gateway app scaffolded (edge app) + Nginx L7 in `core` compose  *(moved from P0)*
- [x] `shared/auth`: JWKS fetch/cache + JWT verify (issuer/audience/exp) + claim extractor (jose)
- [x] Gateway `JwtAuthGuard` + URI versioning + global ValidationPipe + reverse-proxy → catalog
- [x] `shared/tenancy` sources `tenant_id` from verified token (P0 header-trust removed; spoofed header ignored — tested)
- [x] OpenAPI spec + Scalar UI served (catalog `/api/v1/reference`)  *(moved from P0)*

**Slice B1 — Keycloak + RBAC (PR #3 ✅ MERGED):**
- [x] Keycloak realm + clients (public SPA, PKCE + direct-grant) + roles (admin/restaurant-owner/customer/driver) + audience & `tenant_id` mappers + 2 test users; `auth` compose profile (keycloak:26.7 — note: 27.0.0 tag doesn't exist)
- [x] Gateway verifies REAL Keycloak tokens (live JWKS, issuer/audience) — injectable resolver defaults to remote
- [x] `RolesGuard` (RBAC) enforced at the SERVICE on catalog writes (restaurant-owner/admin, reads trusted `x-roles`); reads open to any authenticated tenant
- [x] E2E: authz matrix (401 no-token / 403 customer-write / 201 owner-write / 200 customer-read) with REAL Keycloak-issued tokens (testcontainer + direct-grant)

**Slice B2a — auth service (PR #4 ✅ MERGED):**
- [x] `auth` service (hexagonal): tenant registry (Postgres db `auth`) + user↔tenant map + provisioning admin API (`@Roles('admin')`); gateway proxy `/api/v1/auth/*`
- [x] Keycloak admin adapter (hand-rolled REST/fetch): create user + assign role + set validated `tenant_id` UUID attribute (enforces review M-2). Keycloak 24+ gotchas fixed: set firstName/lastName (User Profile requires them → else "account not fully set up") + realm `unmanagedAttributePolicy=ENABLED` (else admin-set `tenant_id` is dropped)

**Slice B2b — gateway sessions + rate limit (PR #5, open):**
- [x] Redis-backed per-identity rate limiter at the gateway (ioredis fixed-window, keyed by `sub`→IP; 429 + Retry-After; `RATE_LIMIT_*` config, opt-out in tests)
- [x] Gateway auth proxies to Keycloak OIDC (`@Public`, stateless): token (code+PKCE), refresh (rotation), logout/session revoke; realm `revokeRefreshToken` + `refreshTokenMaxReuse:0`
- [x] E2E (real Keycloak + Redis): rate-limit trips 429; refresh rotates + old-reuse rejected; logout revokes session

## Success criteria
- Unauthed write → 401; wrong role → 403; valid owner → 200, all audit-logged with `sub`+`tenant_id`.
- Refresh rotates + old refresh invalidated; logout revokes session.
- Rate limit returns 429 after threshold; counter in Redis.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Keycloak config complexity | H×M | Version realm export JSON; script import; document |
| Clock skew breaks JWT exp | L×M | Allow small leeway; NTP note |
| Header-trust leftover from P0 | M×H | Explicit removal step + test that header is ignored |

## Security considerations
- Authorization Code + PKCE (no implicit flow). Short-lived access token, rotating refresh.
- Verify issuer + audience + signature offline; never trust unverified claims.
- Store no passwords in app DB (Keycloak owns credentials). Secrets via env/compose secrets.
- Row-level tenant isolation enforced centrally; add negative tests for cross-tenant access.

## Security note — realm export is DEV-ONLY
`infra/keycloak/realm-export.json` is a development/test artifact and is **not** safe to promote to any non-dev environment as-is. It intentionally ships:
- `directAccessGrantsEnabled: true` (password grant, so integration/e2e can mint tokens);
- `redirectUris: ["*"]` and `webOrigins: ["*"]` (wildcards);
- `sslRequired: "none"` (allows token transit in clear);
- a `food-delivery-shortlived` public client with a 2s access-token lifespan (used only by the e2e expired-token case).

These are acceptable for the dev realm this phase adds, but wildcard redirects on a public PKCE client plus the password grant broaden the token-exfiltration / credential-stuffing surface. Any non-dev environment requires a **separate hardened realm** with explicit `redirectUris`/`webOrigins`, `directAccessGrantsEnabled: false`, `sslRequired: "external"`, and real confidential client secrets. Do not copy-promote the dev export.

## Next steps
Unblocks P2 (order needs authenticated user + tenant for ownership). gRPC calls will propagate identity via metadata.
