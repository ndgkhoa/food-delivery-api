# Slice B2b — Gateway Redis rate-limiting + auth session proxies

Branch: `feat/gateway-ratelimit-sessions`. Real code, gates green, nothing committed/pushed.
Keycloak/Redis-container e2e written but NOT run (left for you).

## 1. Rate limiter design

Custom Redis fixed-window counter (chose over `@nestjs/throttler`+storage plugin —
a 2-command counter needs no extra abstraction and matches the repo's thin
fetch/ioredis adapter style). Added dep `ioredis@^5.11.1` (verified latest on npm).

- **Storage** (`apps/gateway/src/rate-limit/redis-rate-limit-store.ts`): `INCR` the
  key; on the first hit (`count===1`) `EXPIRE` the window; else read `TTL` (re-arm
  if a crash left it TTL-less). Returns `{count, ttlSec}`. ioredis `lazyConnect:true`
  → socket opens on the FIRST command, so boot never blocks on / requires Redis
  (critical: container-less suites never touch it). `onModuleDestroy` → sync
  `disconnect()` (safe whether or not it ever connected).
- **Port** `RATE_LIMIT_STORE` (`rate-limit-store.ts`) so the guard is unit-testable
  against a fake; Redis stays an infra detail. Bound in `RateLimitModule`.
- **Key** (`rate-limit.guard.ts` `resolveKey`): verified `sub` → `rl:sub:<sub>`;
  else client IP → `rl:ip:<req.ip>`. Uses `req.ip` (socket) NOT client
  `X-Forwarded-For`, so an unauthenticated caller can't rotate the header to dodge
  the limit (prod note: set Express `trust proxy` behind Nginx for real client IP).
- **429**: over `RATE_LIMIT_MAX` → set `Retry-After: <ttlSec>` on the live response,
  then throw `HttpException(429)`. Header survives because the exception filter
  serialises the same response object.
- **Global registration + ordering**: two `APP_GUARD`s in AppModule, order is
  load-bearing — `JwtAuthGuard` FIRST (attaches verified `sub`), `RateLimitGuard`
  SECOND (keys off it). To make JwtAuthGuard global without breaking the public
  session routes, added a `@Public()` decorator (`guards/public.decorator.ts`);
  JwtAuthGuard now checks `Reflector` and skips public routes. Removed the
  per-controller `@UseGuards(JwtAuthGuard)` from catalog/auth proxies.

## 2. Auth session proxies → Keycloak OIDC (thin, stateless — no token storage)

`KeycloakSessionController` (`session/keycloak-session.controller.ts`), `@Public()`,
uses `KeycloakOidcClient` (`session/keycloak-oidc.client.ts`, native fetch, form-encoded):

- `POST /api/v1/auth/token` — `grant_type=authorization_code` + `code`+`code_verifier`+`redirect_uri` → token set.
- `POST /api/v1/auth/refresh` — `grant_type=refresh_token` → rotated token set.
- `POST /api/v1/auth/logout` — backchannel `.../logout` with `client_id`+`refresh_token` (revokes refresh + session), 204.

Keycloak returns tokens verbatim (gateway keeps none). Error mapping: `invalid_grant`
(bad/expired/rotated code or refresh) → 401; other OAuth errors → 400; only the
standard OAuth `error` code is surfaced (never the raw upstream body); logout upstream
failure → 502. Client `KEYCLOAK_URL`+`KEYCLOAK_REALM`+`KEYCLOAK_SPA_CLIENT_ID` (public
PKCE SPA client) from config. DTOs (`session/dto/*`) with class-validator; the global
ValidationPipe (`whitelist`+`forbidNonWhitelisted`) rejects junk.

**Routing coexistence**: both `KeycloakSessionController` and the existing
`AuthProxyController` (`@All('*path')` → auth service) are `@Controller('auth')`.
Session controller is listed FIRST in `controllers[]`, so its specific
`/auth/token|refresh|logout` routes are registered ahead of the catch-all and win;
everything else under `/auth/*` still proxies to the auth service.

## 3. Realm rotation change

`infra/keycloak/realm-export.json` (realm root): added `"revokeRefreshToken": true`
+ `"refreshTokenMaxReuse": 0` → a rotated/old refresh token is invalidated on reuse.
Dev-only posture unchanged.

## 4. Env added

`apps/gateway/src/config/gateway-env-schema.ts` + `.env.example`:
`KEYCLOAK_SPA_CLIENT_ID` (default `food-delivery-spa`), `RATE_LIMIT_ENABLED`
(enum true/false→bool, default true), `RATE_LIMIT_MAX` (100), `RATE_LIMIT_WINDOW_SEC`
(60), `REDIS_URL` (`redis://localhost:6379`).

## 5. How existing e2e stays green under the global limiter

`startGateway` (service-harness) sets `RATE_LIMIT_ENABLED=false` by default and only
enables (with a real Redis URL + low max) when a `rateLimit` option is passed. So
identity-edge + authz-matrix suites: rate limiter short-circuits (`return true`) and
never touches Redis; global JwtAuthGuard still yields 401 on no-token exactly as
before. Defensive: the guard parses `enabled` tolerant of both the zod boolean and a
raw `process.env` string ("false" is truthy) — `@nestjs/config` may hand back either.

## 6. Verification (run locally — NO Keycloak/Redis container e2e)

- `pnpm install` → +ioredis 5.11.1 ✅
- `pnpm nx build gateway` → webpack compiled successfully ✅
- `pnpm biome check .` → clean (1 pre-existing config-migrate *info*, not an error) ✅
- `pnpm cruiser` → no violations (206 modules) ✅
- `pnpm knip --no-config-hints` → clean ✅
- `pnpm nx test gateway` → 3 suites / 15 tests pass ✅ (a KeycloakOidcClient ERROR log is the expected logout-502 case)
- `pnpm nx run-many -t test` → 10 projects, all unit suites green (no regressions) ✅
- `tsc --noEmit -p apps/gateway-e2e/tsconfig.spec.json` → exit 0 (new e2e typechecks) ✅
- `tsc --noEmit -p apps/gateway/tsconfig.app.json` → exit 0 ✅

## 7. Tests written

**Unit (run, passing):**
- `rate-limit/rate-limit.guard.spec.ts` — sub-key under limit passes; IP fallback; over-limit → 429 + `Retry-After`; disabled short-circuits (store untouched).
- `session/keycloak-oidc.client.spec.ts` — code exchange body; refresh rotation body; `invalid_grant`→401; other→400; logout body; logout failure→502.
- `guards/jwt-auth.guard.spec.ts` — added `@Public()`-skip case; updated ctor for `Reflector`.

**E2E (written, NOT run — need your Keycloak + Redis containers):**
- `apps/gateway-e2e/src/rate-limit.e2e-spec.ts` — real Keycloak+Redis+catalog, max=3; N under-limit 200s then 429 + Retry-After (sub-keyed).
- `apps/gateway-e2e/src/auth-session.e2e-spec.ts` — refresh rotates (new refresh ≠ old) + old refresh reuse → 401; logout → 204 then refresh → 401; bogus code exchange → 401.
- Support: `support/redis-container.ts` (GenericContainer, redis:8.8.0-alpine — no new test dep); `support/keycloak-container.ts` gained `mintTokenSet` (access+refresh); `support/service-harness.ts` `startGateway` gained opt-in `rateLimit`.

Run them, e.g.:
`pnpm nx e2e gateway-e2e --testFile=rate-limit.e2e-spec.ts`
`pnpm nx e2e gateway-e2e --testFile=auth-session.e2e-spec.ts`

## 8. Deviations / unresolved

- Full authorization-code+PKCE happy path for `/auth/token` is NOT e2e-covered — a
  real `code` requires an interactive browser login. Covered by unit test (mock fetch)
  + an e2e negative (bogus code → 401). Refresh/logout e2e use the direct-grant refresh
  token, which the task explicitly permitted.
- `RateLimitGuard` reads config defensively (see §5) rather than trusting the zod
  boolean, because `@nestjs/config` ConfigService may return the raw env string; not
  independently confirmed which it returns here, but the guard is correct either way.
- IP-keying uses `req.ip` with no `trust proxy` configured; documented as a prod
  follow-up (behind Nginx all public callers currently share one IP key).

**Status:** DONE
