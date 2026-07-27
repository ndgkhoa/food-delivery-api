# RBAC follow-up test coverage + doc note (PR #3)

**Branch:** `feat/keycloak-login-rbac` · **Scope:** code-review follow-ups M-1, M-3, LOW admin path, LOW expired-token, H-1 doc. M-2 untouched (deferred to auth slice B2). Dev realm kept dev-friendly (not hardened). No commit/push. Keycloak e2e NOT run (user runs it).

## What was added (per finding)

### M-1 — anti-role-spoof e2e
`apps/gateway-e2e/src/authz-matrix.e2e-spec.ts:107` — `it('ignores forged identity headers on a customer token — real role wins (403)')`. Customer token + forged `x-roles: admin`, `x-tenant-id: 99999999-…`, `x-user-id: attacker` on `POST /api/v1/catalog/restaurants` → expects 403. Locks the guarantee that the gateway rebuilds identity from the verified token only (client headers stripped).

### M-3 — menu-item RBAC e2e (nested route)
`authz-matrix.e2e-spec.ts:121` — nested `describe('menu-item write RBAC (nested route)')`. `beforeAll` has the owner create a restaurant (201) and captures `res.body.id`; then customer `POST /restaurants/:id/menu-items` → 403 (`:132`), owner same → 201 (`:140`). Body `{ name, priceCents }` matches `CreateMenuItemRequest` required fields.

### LOW — admin path
- Realm: seeded `admin-user`/`admin-pass` with realm role `admin` + `tenant_id` UUID `11111111-1111-4111-8111-111111111111` — `infra/keycloak/realm-export.json:63` (users array).
- e2e: `adminToken` minted in `beforeAll` (`authz-matrix.e2e-spec.ts:57`); `it('allows an admin to create a restaurant (201)')` at `:96`.

### LOW — expired-token e2e (short-lifespan real token)
- **Approach chosen:** short-lifespan client (not locally-crafted token). Added public direct-grant client `food-delivery-shortlived` with client attribute `access.token.lifespan: "2"` (2s), full audience + `tenant_id` mappers so the token is valid except for expiry — `infra/keycloak/realm-export.json:62` (clients array).
- `mintPasswordToken` gained an optional `clientId` param (default = SPA client) — `apps/gateway-e2e/src/support/keycloak-container.ts:47`.
- e2e: `it('rejects a real expired Keycloak token (401)')` at `authz-matrix.e2e-spec.ts:148`. Mints from the short-lived client, waits **8s**, then a guarded GET → 401.
- **Wait-time rationale (important):** gateway verifier default clock tolerance is 5s (`JWT_CLOCK_TOLERANCE_SEC` default in `apps/gateway/src/config/gateway-env-schema.ts:24`; applied `access-token-verifier.ts:30`). A 2s token stays accepted until ~7s post-issue, so the wait must exceed 2s + 5s — 8s clears both with margin (test timeout raised to 20000ms). Documented in an inline WHY comment. jose expiry itself is unit-covered at `libs/shared/auth/src/access-token-verifier.spec.ts:29` ("rejects an expired token") — cited in the comment.

### H-1 — doc note (realm export is DEV-ONLY)
- (a) New `## Security note — realm export is DEV-ONLY` section in `plans/260725-2139-food-delivery-microservices/phase-01-auth-gateway-hardening.md:83` (before Next steps). States directAccessGrants, `redirectUris:["*"]`, `webOrigins:["*"]`, `sslRequired:none`, and the new short-lived client are dev/test-only; a separate hardened realm is required for any non-dev env.
- (b) Backlog line under `## Deferred` in `plans/260725-2139-food-delivery-microservices/plan.md:56`: "Production Keycloak realm (tighten redirectUris/webOrigins, sslRequired=external, disable direct-grant, real client secrets) — dev realm-export is not prod-safe."

## Files changed
- `infra/keycloak/realm-export.json` — added `admin-user` + `food-delivery-shortlived` client.
- `apps/gateway-e2e/src/support/keycloak-container.ts` — optional `clientId` on mint helper.
- `apps/gateway-e2e/src/authz-matrix.e2e-spec.ts` — 4 new cases (M-1, admin, M-3 nested describe, expired).
- `plans/260725-2139-food-delivery-microservices/phase-01-auth-gateway-hardening.md` — Security note.
- `plans/260725-2139-food-delivery-microservices/plan.md` — Deferred entry.

## Verification (ran)
- `pnpm biome check .` — clean (1 pre-existing config-deprecation info in `biome.json`, unrelated to changes).
- `pnpm cruiser` — no dependency violations (138 modules).
- `pnpm knip --no-config-hints` — clean (no output).
- `pnpm nx build gateway catalog` — both compiled successfully.
- `npx tsc --noEmit -p apps/gateway-e2e/tsconfig.spec.json` — exit 0 (new e2e cases typecheck).
- `realm-export.json` — valid JSON.

## You must run
- `pnpm nx e2e gateway-e2e` (boots real Keycloak 26.7 + Postgres testcontainers; the 4 new cases run against them). Expected new results: admin→201, forged-headers customer→403, menu-item customer→403 / owner→201, expired real token→401.

## Deviations / notes
- Expired-token wait is 8s (not the ~3s the brief suggested) — required because the gateway's 5s clock tolerance would otherwise still accept a 2s token. This keeps the test reliable rather than flaky; no `it.todo` fallback was needed.
- Short-lived client given `redirectUris`/`webOrigins` wildcards + audience/tenant mappers to mirror the SPA client (dev-friendly, consistent); folded into the DEV-ONLY security note.

## Unresolved questions
None.

**Status:** DONE
