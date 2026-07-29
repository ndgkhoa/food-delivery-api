# Gateway Identity Edge — Slice A implementation report

Branch: `feat/auth-gateway-identity` · Nothing committed/pushed. No Keycloak. e2e written but NOT run (handed to you).

## What shipped (scope items 1–5)

1. `libs/shared/auth` — framework-light JWT verify + JWKS + claim extractor + Nest module.
2. `apps/gateway` — edge app: `JwtAuthGuard`, global `ValidationPipe`, URI versioning (`/api/v1`), fetch-based reverse proxy `/api/v1/catalog/*` → catalog, correlation + identity header propagation.
3. `libs/shared/tenancy` — tenant sourced from VERIFIED token identity propagated by the gateway; P0 client `x-tenant-id` header-trust removed; catalog migrated onto it.
4. Nginx L7 (TLS + HTTP fallback) added to compose `core`.
5. Catalog serves OpenAPI spec + Scalar reference UI.

## File tree (new / changed)

```
libs/shared/auth/src/
  index.ts  auth.module.ts  auth.constants.ts  auth-options.ts
  jwks-resolver.ts  access-token-verifier.ts(+spec)  identity.ts(+spec)
  testing/test-jwks.ts
libs/shared/tenancy/src/
  index.ts  tenancy.module.ts  tenant-context.port.ts
  als-tenant-context.adapter.ts(+spec)  trusted-identity.interceptor.ts(+spec)
  identity-headers.ts(+spec)
apps/gateway/src/
  main.ts  app.module.ts  config/gateway-env-schema.ts
  guards/{authenticated-request.ts, jwt-auth.guard.ts(+spec)}
  proxy/{catalog-proxy.controller.ts, http-forwarder.ts}
apps/gateway-e2e/src/
  gateway-identity-edge.e2e-spec.ts  support/service-harness.ts
infra/nginx/nginx.conf  infra/nginx/certs/.gitkeep
(+ project.json / tsconfig* / jest.config.cts / webpack.config.js per project)
```
Catalog changes: `app.module.ts` (uses shared TenancyModule + TrustedIdentityInterceptor), `main.ts` + new `interface/http/setup-openapi.ts`, 10 files repointed to `@food-delivery-api/shared-tenancy`. Deleted: `domain/shared/tenant-context.port.ts` and all of `infrastructure/tenancy/*`.

## JWKS / verify design + test key injection

- `verifyAccessToken(token, {keyResolver, issuer, audience, clockToleranceSec})` — plain function wrapping `jose.jwtVerify` (checks signature + `iss` + `aud` + `exp`, 5s default leeway). No Nest → unit-testable in isolation.
- `AccessTokenVerifier` (`@Injectable`) binds the configured resolver + issuer/audience and returns `extractIdentity(payload)` → `{ sub, tenantId, roles }`. Roles read from `realm_access.roles` (Keycloak) with a flat `roles` fallback; missing `sub`/`tenant_id` → `MissingIdentityClaimError`.
- JWKS source is a **separate DI provider** `JWKS_KEY_RESOLVER`. `SharedAuthModule.forRoot/forRootAsync` bind it to `createRemoteJWKSet` (jose's in-memory cache: `cacheMaxAge` + `cooldownDuration`). Tests/e2e `overrideProvider(JWKS_KEY_RESOLVER).useValue(localSet)`.
- `libs/shared/auth/src/testing/test-jwks.ts` (`createTestKeySet`): generates an RS256 keypair, exposes the public half as a local JWK set (`createLocalJWKSet`) + `sign()` / `signWithWrongKey()` helpers with overridable issuer/audience/expiry — drives the accept-valid / bad-sig / expired / wrong-iss / wrong-aud cases with no live IdP. Imported via a dedicated alias `@food-delivery-api/shared-auth/testing` so test code stays out of the prod barrel.

## Tenancy header-trust removal approach

- The gateway is the single trust boundary. `HttpForwarder` builds the outbound header set **from scratch**: it copies only correlation-id + content-type, never the client's `Authorization` or any client identity header, then calls `applyTrustedIdentityHeaders(headers, req.identity)` which stamps `x-tenant-id`/`x-user-id`/`x-roles` from the VERIFIED token. A spoofed `x-tenant-id` is therefore structurally impossible to smuggle through.
- Services consume the trusted headers via `TrustedIdentityInterceptor` (shared-tenancy), which sets the ALS tenant context and **fails closed with 401** if the tenant header is absent/non-UUID. This replaces catalog's old dev-only interceptor that trusted a raw client `x-tenant-id`.
- Proof tests: `identity-headers.spec.ts` asserts `stripClientIdentityHeaders` clears client copies and `applyTrustedIdentityHeaders` overwrites a spoofed value with the token claim; the gateway e2e drives it end-to-end (authenticate as tenant A + send `x-tenant-id: B` → record lands under A, tenant B sees nothing).

## Proxy mechanism + version

Thin native-`fetch` forwarder (Node 24, no new dep) chosen over `http-proxy-middleware` because it runs AFTER the Nest guard (identity already verified) and lets us construct the outbound headers from scratch — avoiding http-proxy-middleware's body-parsing ordering pitfalls under NestJS and giving airtight header control. Route: `@All('*path')` under `@Controller('catalog')` with global prefix `api` + URI versioning `v1` → `/api/v1/catalog/*path`; strips `/api/v1/catalog`, forwards to `CATALOG_SERVICE_URL` + `/api/v1` + remainder.

## Config / alias / tsconfig changes

- Deps added (root): `jose@^5.10.0`, `@nestjs/swagger@^11.4.6`, `@scalar/nestjs-api-reference@^1.2.11`.
- `tsconfig.base.json` paths: `@food-delivery-api/shared-auth`, `@food-delivery-api/shared-auth/testing`, `@food-delivery-api/shared-tenancy`, `@gateway/*`.
- `knip.json`: mirrored the new aliases in `paths`; added `libs/**/src/testing/**/*.ts` to `entry`.
- `gateway-env-schema.ts` = `baseEnvSchema.omit(DB_*).extend({ CATALOG_SERVICE_URL, JWKS_URI, JWT_ISSUER, JWT_AUDIENCE, JWT_CLOCK_TOLERANCE_SEC, PORT:default 3000 })` (gateway is stateless — no DB).
- `.env.example` + `infra/docker-compose.yml` (nginx service, core profile, `host.docker.internal`) + `infra/nginx/nginx.conf` (mkcert/openssl steps + HTTP fallback documented in-file) + `.gitignore` (certs).

## Verification (ran locally)

| Gate | Result |
|------|--------|
| `pnpm install` | clean |
| `pnpm nx build gateway` | success |
| `pnpm nx build catalog` | success |
| `pnpm biome check .` | exit 0 (1 pre-existing config-migration *info*, unrelated) |
| `pnpm cruiser` | no violations (132 modules) |
| `pnpm knip --no-config-hints` | exit 0 |
| `nx test shared-auth` | 2 suites / 11 tests pass |
| `nx test shared-tenancy` | 3 suites / 9 tests pass |
| `nx test gateway` | 1 suite / 4 tests pass |
| `nx test catalog` (regression) | 8 suites / 39 tests pass (testcontainers) |
| gateway routing smoke (built app) | guarded `/api/v1/catalog/*` → 401 no/bad token; unknown path → 404 |

**Left for you:** `apps/gateway-e2e` (boots gateway + catalog on testcontainers Postgres with injected test JWKS) — written, NOT run per instructions. Run: `pnpm nx e2e gateway-e2e`. Catalog e2e also unchanged and left for you.

## Tests added

- shared-auth: token verify (valid/bad-sig/expired/wrong-iss/wrong-aud) + `AccessTokenVerifier`; `extractIdentity` claim extraction.
- shared-tenancy: ALS adapter; `TrustedIdentityInterceptor` (context set / fail-closed); identity-header spoof resistance.
- gateway: `JwtAuthGuard` (valid→pass+identity attached; missing/non-bearer/expired→401).
- gateway-e2e: 401 unauth, 200 authed proxy, tenant isolation by token claim vs spoofed header.

## Deviations + unresolved

- **jose pinned to v5.10.0, not latest v6.** v6 is ESM-only (`"type":"module"`, no `require` export) and breaks the repo's CommonJS ts-jest/webpack toolchain without adding ESM-transform config. v5.10.0 is the latest dual CJS/ESM line with an identical verify/JWKS API. Bump to v6 later alongside a broader ESM migration.
- **Scalar UI points at `url:'/api/v1/openapi.json'`** (served by us) rather than inlining `content`, because the `content` config key wasn't confirmable in the installed types while `url` was. Scalar's client bundle loads from jsDelivr CDN (needs internet in dev); the generated spec has route-level detail but no rich DTO schemas (no `@nestjs/swagger` CLI plugin wired — YAGNI for this slice).
- **Local dual-run port collision:** `.env` sets `PORT=3001` globally, so running catalog and gateway together off `.env` both read 3001. Gateway *defaults* to 3000 but `.env` overrides. Set `PORT` per process (or add `GATEWAY_PORT`) when running both locally. e2e is unaffected (uses `listen(0)`).
- **Nginx in `core` needs certs first:** the `:443` block references `infra/nginx/certs/dev.{crt,key}` (git-ignored). Without them nginx won't start — generate via the documented mkcert/openssl commands, or comment the 443 block and use the working `:80` HTTP fallback.
- **Defense-in-depth (deferred to Slice B):** catalog still trusts the gateway-set `x-tenant-id` at its boundary; it does not itself re-verify the JWT. A direct (gateway-bypassing) call with a hand-set `x-tenant-id` would still be trusted. The plan assigns per-service audience/tenant re-checks + RBAC to Slice B; this slice's spoof-resistance is enforced at the gateway.

**Status:** DONE
