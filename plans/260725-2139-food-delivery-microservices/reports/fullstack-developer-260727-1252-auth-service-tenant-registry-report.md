# Auth service (Slice B2a) — tenant registry + provisioning

Branch: `feat/auth-service-tenant-registry`. Real, working hexagonal service mirroring `apps/catalog`. NOT committed/pushed. Keycloak-container tests written but NOT run (left for you).

## Status: DONE

All required gates green: `nx build auth gateway catalog`, `biome check .`, `cruiser`, `knip`, `nx test auth` (unit + testcontainer infra), and `tsc --noEmit` on the Keycloak e2e specs. Full workspace `nx run-many -t test` = 10/10 projects pass, no regressions.

---

## File tree (`apps/auth` + `apps/auth-e2e`)

```
apps/auth/
├── project.json · webpack.config.js · jest.config.cts
├── tsconfig.json · tsconfig.app.json · tsconfig.spec.json
└── src/
    ├── main.ts                                   # bootstrap, prefix api/v1, port 3002
    ├── app.module.ts                             # composition root (RolesGuard + DomainErrorFilter)
    ├── config/auth-env-schema.ts                 # base env + Keycloak admin vars
    ├── assets/.gitkeep
    ├── domain/
    │   ├── tenant/ tenant.ts · tenant.repository.ts
    │   │          user-tenant-link.ts · user-tenant-link.repository.ts
    │   ├── keycloak/ keycloak-admin.port.ts       # framework-free port + token
    │   └── shared/ errors.ts · pagination.ts · uuid.ts   # assertValidTenantId = M-2
    ├── application/tenant/
    │   ├── commands/ create-tenant.handler.ts · provision-user.handler.ts
    │   └── queries/  get-tenant.handler.ts · list-tenants.handler.ts
    ├── infrastructure/
    │   ├── persistence/ entities/{tenant,user-tenant-map}.orm-entity.ts
    │   │                mappers/{tenant,user-tenant-link}.mapper.ts
    │   │                repositories/typeorm-{tenant,user-tenant-link}.repository.ts
    │   │                migrations/1753660800000-create-auth-tables.ts
    │   │                data-source.ts · typeorm-options.ts · persistence.module.ts
    │   └── keycloak/    keycloak-admin-http.adapter.ts · keycloak.module.ts
    ├── interface/http/
    │   ├── tenants.controller.ts                 # @Roles('admin') on the controller
    │   ├── dto/ create-tenant.request · provision-user.request · pagination.request
    │   │        tenant.response · provisioned-user.response · paginated.response
    │   ├── mappers/ tenant-response.mapper · provisioned-user-response.mapper
    │   ├── filters/ domain-error.filter.ts
    │   └── setup-openapi.ts
    └── testing/auth-test-database.ts             # testcontainers Postgres + migration

apps/auth-e2e/            (WRITE-only; you run these)
├── project.json · jest.config.cts · tsconfig.json · tsconfig.spec.json
└── src/
    ├── support/ keycloak-container.ts · service-harness.ts
    ├── keycloak-admin.e2e-spec.ts                # adapter vs real Keycloak
    └── provisioning.e2e-spec.ts                  # create tenant → provision → mint token
```

Tests (unit + infra, DO run): `tenant.spec.ts`, `uuid.spec.ts`, `tenant-handlers.spec.ts`, `typeorm-auth-repositories.spec.ts`.

## Registry schema + migration

`migrations/1753660800000-create-auth-tables.ts` (filename = domain slug only, no phase token):

- **tenants**: `id uuid PK default gen_random_uuid()`, `name varchar(255)`, `slug varchar(255)` + UNIQUE index, `is_active boolean default true`, `created_at`/`updated_at timestamptz`. No soft-delete (scope = id/name/slug/isActive/timestamps).
- **user_tenant_map**: `id uuid PK`, `keycloak_user_id varchar(255)` + UNIQUE index (one user → one tenant), `tenant_id uuid` FK→tenants(id) ON DELETE CASCADE + index, `role varchar(50)`, `created_at`. Append-only (no updated_at/soft-delete).
- `tenants.id` (a generated UUID) is the value stamped as each provisioned user's `tenant_id` claim — the root of M-2.

Migration loaded as a class ref in the testcontainer helper (same trick as catalog) so ts-jest runs it without ts-node.

## KeycloakAdminPort design + adapter (REST, no lib)

**Decision: hand-rolled Keycloak Admin REST calls via native `fetch`** — NOT `@keycloak/keycloak-admin-client`. That package is absent from the lockfile; the task allowed hand-rolling, and it matches the fetch pattern already in `gateway-e2e/keycloak-container.ts` + `gateway/http-forwarder.ts`, avoiding a new dep + ESM/CJS interop under webpack/jest. Verified against Keycloak 26.7 + Node 24.14.

- **Port** (`domain/keycloak/keycloak-admin.port.ts`): `createUser({tenantId, username, email, role, password}) → Promise<userId>` + `KEYCLOAK_ADMIN_PORT` token. Intentionally coarse — one call does user-create + `tenant_id` attribute + role assignment so the application layer never touches the Keycloak protocol.
- **Adapter** (`infrastructure/keycloak/keycloak-admin-http.adapter.ts`), 3 REST steps:
  1. `POST /realms/master/protocol/openid-connect/token` — admin-cli password grant with bootstrap `KEYCLOAK_ADMIN`/`_PASSWORD`.
  2. `POST /admin/realms/{realm}/users` with `attributes.tenant_id=[uuid]` + password credential → read `Location` for the new id. 409 → `KeycloakAdminError(409)`.
  3. `GET /admin/realms/{realm}/roles/{role}` then `POST …/users/{id}/role-mappings/realm` → assigns the realm role. Unknown role → 400.
- Config from `ConfigService` (`KEYCLOAK_URL`/`REALM`/`ADMIN`/`ADMIN_PASSWORD`), injected globally by `SharedConfigModule`.

## M-2 UUID enforcement (how it holds)

1. `create-tenant` generates the tenant id via `randomUUID()` → tenant ids are valid UUIDs **by construction**.
2. `provision-user` calls `assertValidTenantId(tenantId)` (`domain/shared/uuid.ts`, RFC-4122 v1–5 regex) **before** any Keycloak call — a non-UUID throws `InvalidUuidError` → HTTP 400, and neither Keycloak nor the link write happens.
3. Only then is the tenant loaded (404 if missing) and its UUID passed to `KeycloakAdminPort.createUser`, which stamps it as the `tenant_id` attribute → every future token for that user carries a valid `tenant_id`.
   Proven by `tenant-handlers.spec.ts` (fake port asserts UUID + role + link) and, when you run it, `keycloak-admin.e2e-spec.ts` / `provisioning.e2e-spec.ts` (decode the minted token, assert `tenant_id` + `realm_access.roles`).

## Gateway proxy + admin RBAC

- Refactored `HttpForwarder.forward(req, res, target)` to be stateless/reusable — takes `{ gatewayPrefix, baseUrl }` instead of hardcoding catalog. Same allowlist-header behaviour (builds outbound headers from scratch, only gateway-verified identity via `applyTrustedIdentityHeaders`; client Authorization/spoofed headers dropped; 504/502 fail-closed).
- New `AuthProxyController` (`@Controller('auth')`, `@UseGuards(JwtAuthGuard)`) forwards `/api/v1/auth/*` → `AUTH_SERVICE_URL`. `CatalogProxyController` updated to the new signature (behaviour identical; gateway-e2e still type-checks).
- Added `AUTH_SERVICE_URL` (default `http://localhost:3002`) to `gateway-env-schema.ts`; registered the controller in gateway `app.module.ts`.
- **Admin RBAC enforced at the auth service** (not the gateway): every route is under `@Roles('admin')`; the composition root registers `RolesGuard` (from `@food-delivery-api/shared-tenancy`) as `APP_GUARD`, reading the gateway-stamped `x-user-id`/`x-roles` (missing identity → 401, non-admin → 403). The auth service does NOT wire `TrustedIdentityInterceptor`/`TenancyModule` — the registry API is platform-scoped, not caller-tenant-scoped (YAGNI).

## Env / knip / config / DB wiring changes

- `tsconfig.base.json` + `knip.json`: added `@auth/*` alias; added `apps/auth/src/infrastructure/persistence/data-source.ts` to knip entry.
- `package.json`: added `migration:auth:{generate,run,revert}` scripts (tsx pattern, `-d apps/auth/.../data-source.ts`).
- `apps/auth/config/auth-env-schema.ts`: extends `baseEnvSchema` (DB_* for its own registry) + `PORT` default 3002 + `DB_NAME` default `auth` + `KEYCLOAK_URL/REALM/ADMIN/ADMIN_PASSWORD`.
- **DB wiring** (per coordinator): the registry lives in the **shared core Postgres (5432)** under database `auth` — NO separate compose service (catalog/gateway also run via `nx serve`; only infra is in compose). Run with `DB_NAME=auth` override. `.env.example` documents this incl. one-time `createdb -h localhost -U postgres auth` and the `DB_NAME=auth pnpm migration:auth:run` command. `data-source.ts` defaults DB_PORT 5432 / DB_NAME `auth`.
- No `@keycloak/*` dependency added; no compose change; no Dockerfile (matches current catalog/gateway = host-run).

## Verification outputs (all run by me)

| Gate | Result |
|------|--------|
| `pnpm install` | up to date |
| `pnpm nx run-many -t build -p auth gateway catalog` | 3/3 success |
| `pnpm biome check .` | clean (1 info = pre-existing config-migration notice) |
| `pnpm cruiser` | ✔ no violations (189 modules) — auth hexagonal layer rules pass |
| `pnpm knip --no-config-hints` | clean (no output) |
| `pnpm nx test auth` | 4 suites / 25 tests pass (incl. testcontainer Postgres infra-integration) |
| `pnpm nx run-many -t test` | 10/10 projects pass, 0 regressions |
| `tsc --noEmit -p apps/auth-e2e/tsconfig.spec.json` | exit 0 |
| `tsc --noEmit -p apps/gateway-e2e/tsconfig.spec.json` | exit 0 (after forwarder refactor) |

## Tests: written vs run

- **Ran (green):** domain (`tenant.spec.ts`, `uuid.spec.ts`), application (`tenant-handlers.spec.ts` — fake `KeycloakAdminPort` + fake repos, proves valid-UUID tenant_id + role + link), infra-integration (`typeorm-auth-repositories.spec.ts` — testcontainers Postgres, migration round-trip, unique-slug + FK constraints).
- **Written, NOT run (you run — Keycloak container):**
  - `apps/auth-e2e/src/keycloak-admin.e2e-spec.ts` — adapter vs real Keycloak; mints the created user's token, asserts `tenant_id` + role claims; asserts 409 on duplicate.
  - `apps/auth-e2e/src/provisioning.e2e-spec.ts` — through the gateway: admin token → create tenant → provision owner → mint owner token → assert role + valid UUID `tenant_id`; plus 401/403 negative cases.
  - **Commands to run them:**
    - `pnpm nx e2e auth-e2e` (both), or
    - `pnpm nx e2e auth-e2e --testFile=keycloak-admin.e2e-spec.ts`
    - `pnpm nx e2e auth-e2e --testFile=provisioning.e2e-spec.ts`

## Deviations / unresolved

- **"provision-user creates the tenant if needed"** (scope §2) reconciled with the REST contract `POST /tenants/:id/users` (scope §4): provisioning targets an **existing** tenant (id from the path); tenant creation is the separate `POST /tenants`. M-2's "generate one for a new tenant" is satisfied by `create-tenant`'s `randomUUID()`; "reject/normalize otherwise" by `assertValidTenantId` in provisioning. Flag if you want provisioning to auto-create a tenant inline instead.
- **No dedicated auth Postgres container** — followed coordinator's "core Postgres, DB_NAME=auth, no separate compose service". Requires a one-time `createdb auth` in the core Postgres (documented in `.env.example`); the `auth` DB is not auto-created by compose. Infra tests use their own testcontainer, so gates don't depend on it.
- **Shared `.env` DB_* collision**: catalog pins `DB_NAME=catalog`; auth needs `DB_NAME=auth`. Documented as a per-run override (`DB_NAME=auth nx serve auth`) — inherent to one shared root `.env` with two DB-owning services run on the host.
- **No auth service in docker-compose** (matches current catalog/gateway host-run pattern; no service Dockerfiles exist yet). When services are containerized later, auth joins the `core` profile.
```
