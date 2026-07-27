# Auth service PR #4 — code-review fixes report

Branch: `feat/auth-service-tenant-registry`. Scope: focused fixes + tests for review findings H-1, H-2, M-1, L-1 plus test backfill. No commit/push. Keycloak-container e2e NOT run (left for reviewer).

## Per-finding changes

### H-1 — provisioning compensation (create-then-compensate, not Saga)
- `apps/auth/src/domain/keycloak/keycloak-admin.port.ts:11-27` — added `deleteUser(userId)` to `KeycloakAdminPort`; rewrote docstring to drop the false "atomic" claim and describe create-then-compensate + the 409 behavior + Saga deferral.
- `apps/auth/src/infrastructure/keycloak/keycloak-admin-http.adapter.ts:54-57` — implemented `deleteUser` (auth → `DELETE /admin/realms/{realm}/users/{id}`).
- `.../keycloak-admin-http.adapter.ts:40-52` — wrapped `assignRealmRole` in try/catch; on failure the just-created user is deleted (`compensateDelete`) so `createUser` is all-or-nothing from the caller (closes the "user exists without role" orphan window inside the adapter).
- `.../keycloak-admin-http.adapter.ts:118-160` — `deleteUserRecord` (204 = deleted, 404 = already gone → idempotent, else 502) + `compensateDelete` (best-effort; if the delete itself fails, logs both errors server-side and throws a clear "orphaned … manual reconciliation" 502).
- `apps/auth/src/application/tenant/commands/provision-user.handler.ts:40-92` — wrapped the registry write (`UserTenantLink.create` + `save`) in try/catch; on failure `compensate()` best-effort-deletes the just-created Keycloak user then rethrows the original error (or, if compensation also fails, throws a "manual reconciliation required" error). Added class docstring documenting the inconsistency window + chosen 409 behavior. Added a `Logger` (WARN on successful compensation, ERROR when compensation fails).
- `plans/260725-2139-food-delivery-microservices/plan.md:59` — added the "## Deferred" backlog line for fully-transactional provisioning via Saga/Outbox.

Design — compensation covers BOTH failure windows:
1. Adapter-internal: role-assign fails after user record created → adapter deletes the user (keeps the coarse `createUser` port contract honest).
2. Handler-level: registry `save` fails after `createUser` returned → handler calls `keycloakAdmin.deleteUser`.
Both are best-effort; a failed compensation surfaces BOTH the original cause and the delete failure (logged + in the thrown message) so an operator can reconcile.

Idempotency on 409 — chosen behavior: return a clear 409 (existing `KeycloakAdminError(409)` → filter → HTTP 409), NOT auto-reconcile. Rationale (documented in the handler docstring): with compensation in place a genuine orphan should no longer occur, so a 409 now reliably means the username is truly taken; retry after removing the conflicting user is safe. Reconcile-on-409 rejected as YAGNI for this phase.

### H-2 — duplicate slug → 409 (not 500)
- `apps/auth/src/infrastructure/persistence/repositories/typeorm-tenant.repository.ts:1-33` — `save` now catches `QueryFailedError` with Postgres SQLSTATE `23505` and throws domain `ConflictError` (→ existing filter → HTTP 409). Handler pre-check kept for the friendly common path; this closes the concurrent-race window. `throw error` preserved for any other DB error.

### M-1 — remove weak admin-cred defaults
- `apps/auth/src/config/auth-env-schema.ts:17-24` — dropped `.default('admin')` on both `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`; now `z.string().min(1)` (required) so a missing value fails loud at boot instead of silently using admin/admin. Docstring explains why.
- `.env.example:34-41` — documented that these are REQUIRED (no schema default) and the dev values are convenience-only; must be overridden with strong secrets outside local dev.

### L-1 — don't leak upstream body
- `apps/auth/src/infrastructure/keycloak/keycloak-admin-http.adapter.ts:104-112` — on a non-201/non-409 user-creation response, the raw Keycloak body is logged server-side via the injected `Logger` and the thrown `KeycloakAdminError` now carries a generic `"Upstream identity provider error"` message (no body echoed to the client).

## Tests added / updated
- `apps/auth/src/application/tenant/tenant-handlers.spec.ts` — `FakeKeycloakAdmin.deleteUser` (records calls); `FakeUserTenantLinkRepository.failOnSave`; new tests: (a) registry write fails → `deleteUser('kc-user-1')` called + no `user_tenant_map` row saved (H-1 compensation); (b) password never persisted on the registry link (grep-proof: serialized row contains neither the password value nor any `password` field).
- `apps/auth/src/interface/http/dto/provision-user.request.spec.ts` (new) — invalid role (`superadmin`) → validation error (`isIn`) → 400; each of the 4 provisionable roles accepted. (Placed in interface layer to respect the `application-no-outward-deps` cruiser rule.)
- `apps/auth/src/infrastructure/keycloak/keycloak-admin-http.adapter.spec.ts` (new, `fetch` stubbed, no container) — (a) L-1: create-fail surfaces exactly the generic message (raw body cannot leak); (b) role-assign failure triggers a compensating DELETE of the created user; (c) `deleteUser` treats 204 & 404 as success (idempotent); (d) genuine delete failure → 502.
- `apps/auth/src/infrastructure/persistence/repositories/typeorm-auth-repositories.spec.ts` — the duplicate-slug integration test (real Postgres via testcontainers) now asserts `ConflictError` instead of a raw throw (H-2, HTTP-level 409 gap now covered by CI).
- `apps/auth-e2e/src/provisioning.e2e-spec.ts` — added invalid-role → 400 negative test (Keycloak-dependent; written, NOT run).

## Verification (run)
- `pnpm nx build auth gateway` — PASS (both compiled).
- `pnpm biome check .` — clean (only 1 pre-existing config-migrate info, unrelated).
- `pnpm cruiser` — PASS (no dependency violations, 191 modules).
- `pnpm knip --no-config-hints` — clean (no output).
- `pnpm nx test auth` — PASS: 6 suites, 36 tests. Includes the Postgres-testcontainer integration suite (H-2 ConflictError proven against real DB). Logs confirm handler compensation WARN and L-1 server-side ERROR fire.
- `tsc -p apps/auth/tsconfig.spec.json --noEmit` — PASS.
- `tsc -p apps/auth-e2e/tsconfig.spec.json --noEmit` — PASS (Keycloak/e2e specs typecheck, incl. new invalid-role test).

## Left for reviewer (per instructions)
- Keycloak-container e2e (`pnpm nx e2e auth-e2e`) — NOT run. The new invalid-role e2e test and unchanged provisioning/keycloak-admin e2e specs typecheck but were not executed.

## Deviations / notes
- Compensation was added in TWO places (adapter role-assign window + handler registry-write window) rather than only the handler, because role-assign lives inside the adapter's `createUser`; the requested handler-level unit test stubs the port and exercises the registry-write window, while the fetch-stubbed adapter spec covers the role-assign window. This fully closes H-1 without a port refactor.
- No code comments/filenames reference plan/finding codes (per repo rule); findings are cited only here.

## Unresolved questions
1. Is `user_tenant_map` used for a downstream authorization decision, or purely informational? Affects whether a (now-compensated) orphan would have been a security gap vs bookkeeping drift. Compensation makes it moot for the happy failure path, but confirms severity if compensation itself fails.
2. Is the target realm `duplicateEmailsAllowed=false`? (L-3, out of scope here — email dedupe still relies on realm config.)

**Status:** DONE
**Summary:** H-1/H-2/M-1/L-1 fixed with focused changes + tests; build, biome, cruiser, knip, and `nx test auth` (36 tests incl. Postgres testcontainer) all green; e2e specs typecheck. Keycloak-container e2e left for the reviewer.
