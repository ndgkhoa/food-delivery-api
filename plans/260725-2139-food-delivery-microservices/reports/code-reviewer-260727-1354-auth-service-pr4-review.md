# Code Review — PR #4: auth service (tenant registry + Keycloak user provisioning)

Branch: `feat/auth-service-tenant-registry` → `develop`
Reviewer: code-reviewer (adversarial / production-readiness)
Date: 2026-07-27

## Verdict

**APPROVE WITH CHANGES** — no hard security merge-blocker given the accepted network-trust model. Password/secret handling, RBAC coverage, and M-2 UUID enforcement are all sound. Two items should be fixed or explicitly ticketed before merge:

- **H-1** provisioning partial-failure leaves an orphaned, login-capable Keycloak identity with no compensation and permanently blocks re-provisioning; the port doc overstates it as "atomic".
- **H-2** tenant-create is check-then-insert; a concurrent duplicate slug bypasses the friendly 409 and surfaces a raw DB error as 500.

Everything else is low/informational or test-coverage gaps.

---

## Scope
- Files: `apps/auth/**` (39), `apps/auth-e2e/**` (4), gateway proxy + env (`apps/gateway/src/proxy/auth-proxy.controller.ts`, `app.module.ts`, `gateway-env-schema.ts`), `.env.example`.
- Focus: provisioning atomicity, Keycloak admin adapter, password/secret handling, input validation, RBAC, tenant registry correctness, M-2 UUID.
- Not re-raised (per instructions): network-trust invariant, dev-only realm hardening, already-green gates.

---

## Critical
None.

---

## High

### H-1 — Provisioning is not atomic: orphaned Keycloak identity + no compensation + re-provision deadlock
`apps/auth/src/application/tenant/commands/provision-user.handler.ts:50-64`
`apps/auth/src/infrastructure/keycloak/keycloak-admin-http.adapter.ts:39-44`
`apps/auth/src/domain/keycloak/keycloak-admin.port.ts:11-20`

The flow is `createUser (Keycloak: POST user → assign role)` **then** `userTenantLinkRepository.save (local DB)`. Two independent failure windows, neither compensated:

1. **DB link write fails after Keycloak user created** (DB down, or unique-violation on `keycloak_user_id`): the Keycloak user already exists — `enabled:true`, `emailVerified:true`, `tenant_id` attribute set, realm role assigned — so it **can authenticate and its token carries the role + tenant_id**, but there is **no `user_tenant_map` row**. The handler throws (raw DB error → 500, not a domain error). No cleanup deletes the Keycloak user.
2. **`assignRealmRole` fails after `createUserRecord` succeeds** (`keycloak-admin-http.adapter.ts:42`): user exists in Keycloak without a role; `createUser` throws before returning, so again no link row and no cleanup.

Follow-on trap: because the Keycloak user now exists, **retrying the same provision request returns 409** (`keycloak-admin-http.adapter.ts:101-103`) → the admin can never complete provisioning for that username, and the orphan lingers. The registry (`user_tenant_map`) and Keycloak are silently divergent.

The port docstring claims the operation is an "atomic-from-the-caller unit" (`keycloak-admin.port.ts:14-16`) — it is not; it is two-to-three sequential REST calls with no rollback. The handler docstring documents *why there is no DB transaction* but never documents the orphan/inconsistency window.

**Scenario:** admin provisions `owner@acme`; Keycloak creates the user + role, then the auth DB briefly errors on `save`. Client gets 500. Admin retries → 409 "already exists". Result: a fully login-capable user that is invisible to the registry, and no supported recovery path.

**Fix (min viable, Saga out of scope):**
- Add compensation: on link-save failure, best-effort `DELETE /admin/realms/{realm}/users/{id}` (or disable the user) so the operation is all-or-nothing from the caller's view; log if compensation itself fails.
- OR make provisioning idempotent/recoverable: before `createUser`, check `findByKeycloakUserId`/username; on a 409 with a missing link, look up the existing Keycloak user id and reconcile the link instead of hard-409.
- At minimum: correct the port docstring (drop "atomic"), document the inconsistency window in the handler, and map the post-Keycloak DB failure to a clear 5xx that tells the caller a manual reconcile may be needed. File a follow-up ticket if compensation is deferred.

### H-2 — Tenant create is check-then-insert; concurrent duplicate slug → unhandled 500 instead of 409
`apps/auth/src/application/tenant/commands/create-tenant.handler.ts:18-26`
`apps/auth/src/infrastructure/persistence/repositories/typeorm-tenant.repository.ts:17-20`
`apps/auth/src/interface/http/filters/domain-error.filter.ts:20`

`CreateTenantHandler` does `findBySlug` then `save`. Two concurrent creates with the same slug both pass the `findBySlug` check; one `save` wins, the other hits the `idx_tenants_slug` unique index and TypeORM throws `QueryFailedError`. `DomainErrorFilter` only catches domain errors (`@Catch(EntityNotFoundError, ConflictError, InvalidUuidError, KeycloakAdminError)`), so the raw DB error falls through to Nest's default handler → **500, not the friendly 409**. The integration test at `typeorm-auth-repositories.spec.ts:68-73` confirms the repo surfaces a raw `throw` (not `ConflictError`) on the unique violation.

**Scenario:** two admin tabs (or a retried request) POST the same slug near-simultaneously → one gets an opaque 500 with a leaked DB message instead of "slug already taken".

**Fix:** translate the Postgres unique-violation (SQLSTATE `23505`) to `ConflictError` in `TypeOrmTenantRepository.save` (or a small persistence error-mapper), so the existing 409 path covers the race. Keeps the pre-check for the common case, closes the window.

---

## Medium

### M-1 — Keycloak admin creds have permissive defaults; misconfigured prod silently uses `admin`/`admin`
`apps/auth/src/config/auth-env-schema.ts:18-19`
`apps/auth/src/infrastructure/keycloak/keycloak-admin-http.adapter.ts:35-36`

`KEYCLOAK_ADMIN` defaults to `'admin'` and `KEYCLOAK_ADMIN_PASSWORD` to `'admin'`. The adapter reads them via `config.getOrThrow`, but because the schema supplies defaults, `getOrThrow` **never throws** — a deployment that forgets to set the admin password silently authenticates as `admin/admin` against the master realm rather than failing fast. This adapter holds master-realm admin power (create users, assign roles), so a weak default is higher-stakes than a normal dev default.

This may overlap the accepted "dev-only realm hardening" backlog — flagging because it is an env-schema default (not just realm config) and fails open. **Fix:** drop the default on `KEYCLOAK_ADMIN_PASSWORD` (require it), or gate the defaults behind non-production `NODE_ENV` so prboot fails loudly when unset.

---

## Low / Informational

- **L-1 Upstream error body echoed to client.** `keycloak-admin-http.adapter.ts:104-108` builds the 502 message with `await response.text()` from Keycloak, surfaced verbatim by `DomainErrorFilter` (`message: exception.message`). Can leak internal Keycloak detail to the API caller. Prefer a generic message + server-side log of the raw body.
- **L-2 Admin token fetched per call, not cached.** `keycloak-admin-http.adapter.ts:40,47-70` authenticates on every `createUser`, and each provision makes 3–4 sequential Keycloak round-trips. Fine for an infrequent admin op; revisit only if bulk provisioning appears.
- **L-3 `emailVerified: true` set unconditionally + email uniqueness depends on realm config.** `keycloak-admin-http.adapter.ts:91`. Provisioned emails are trusted without verification; the 409 dedupe is on **username** only (`:101`), so duplicate emails are allowed unless the realm sets `duplicateEmailsAllowed=false`. Acceptable for admin-provisioned users, but worth an explicit note.
- **L-4 No pre-check for an existing link before the Keycloak call.** Provisioning relies solely on Keycloak's 409. Acceptable, but interacts with H-1's re-provision deadlock.

---

## Positive Observations
- **No header spoofing.** `apps/gateway/src/proxy/http-forwarder.ts:43-49` builds the outbound header set from scratch and applies only the gateway-derived identity; client `Authorization`/spoofed `x-roles`/`x-user-id` are never copied. Solid trust boundary.
- **Password handling is clean.** Password flows DTO → command → `keycloakAdmin.createUser` → Keycloak credential only. Not persisted (`UserTenantLink`/`user_tenant_map` have no password field), not in the response DTO (`provisioned-user.response.ts`), not logged (grep clean; pino redacts `authorization`/`cookie` and does not log bodies — `logging.module.ts:24`).
- **RBAC coverage complete.** `@Roles('admin')` at class level on `TenantsController` (`:23`) covers all four routes via `getAllAndOverride([handler, class])`; `RolesGuard` is a global `APP_GUARD` and fails closed (401 on missing verified identity, 403 on missing role — `roles.guard.ts:45-52`). No unguarded provisioning/tenant route.
- **M-2 double-enforced.** `ParseUUIDPipe` on the `:id` param (`tenants.controller.ts:40,56`) + `assertValidTenantId` in the handler (`provision-user.handler.ts:43`) + tenant-existence check → every stamped `tenant_id` is a valid, real UUID. e2e proves the claim end-to-end (`provisioning.e2e-spec.ts:113-117`).
- **Role validated at the edge.** `@IsIn(PROVISIONABLE_ROLES)` (`provision-user.request.ts:20`) rejects arbitrary roles as 400; adapter also maps a Keycloak role-404 to 400 (`keycloak-admin-http.adapter.ts:125-127`) — defense in depth.
- **Schema integrity.** Unique slug index, FK `user_tenant_map.tenant_id → tenants.id ON DELETE CASCADE`, unique `keycloak_user_id`; `synchronize:false`; integration tests exercise real Postgres + real migration.
- Input hardening: `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` globally (`main.ts:17-23`); pagination bounded (`Min(1)/Max(100)`).

---

## Test Quality / Gaps
Tests prove the happy path + M-2 + RBAC 401/403 well. Missing coverage for the exact defects above:
- **No test for provisioning partial failure** (link save fails *after* Keycloak create → orphan / re-provision 409). This is the highest-risk untested path (H-1).
- **No test for the duplicate-slug race / 409 mapping through the HTTP filter** — only a domain-level `ConflictError` unit test and an integration test asserting a *raw* throw. The 500-vs-409 gap (H-2) is therefore invisible to CI.
- **No test asserting password is not persisted / not returned / not logged** — the claim holds (verified by reading), but is unproven by a regression test.
- **No negative test for invalid-role** (e2e does not assert a 400 for a role outside `PROVISIONABLE_ROLES`).

---

## Recommended Actions (priority order)
1. H-1: add Keycloak compensation (delete/disable on link-save failure) or an idempotent-reconcile path; fix the misleading "atomic" port docstring and document the inconsistency window. Add a partial-failure test.
2. H-2: map Postgres `23505` → `ConflictError` in `TypeOrmTenantRepository.save`; add an HTTP-level duplicate-slug test.
3. M-1: require `KEYCLOAK_ADMIN_PASSWORD` (or gate defaults to non-prod) so misconfig fails fast.
4. L-1: stop echoing raw Keycloak response bodies to clients.
5. Backfill tests: invalid-role 400, password-not-persisted/returned.

---

## Unresolved Questions
1. Is the `user_tenant_map` registry ever used for an authorization decision downstream, or is it purely informational? This determines whether an H-1 orphan (login-capable but unregistered) is a security gap or just a bookkeeping drift.
2. Is the target realm configured with `duplicateEmailsAllowed=false`? If not, L-3 allows multiple users per email.
3. Are M-1's permissive admin-cred defaults already covered by the accepted "dev-only realm hardening" backlog item, or should the prod-fail-fast change land in this PR?
