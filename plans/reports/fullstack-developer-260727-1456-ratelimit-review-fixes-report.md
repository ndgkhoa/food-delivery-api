# Gateway rate-limit/session PR #5 — code-review fixes

**Branch:** `feat/gateway-ratelimit-sessions` · **Date:** 2026-07-27
**Scope:** H1 (fail-open), H2 (trust proxy), health endpoint + rate-limit exemption, tests M-1/M-2/health.
**Not committed/pushed** (per instructions). Keycloak/Redis container e2e NOT run.

## Per-finding changes

### H1 — Redis-down → FAIL-OPEN (was 500)
`apps/gateway/src/rate-limit/rate-limit.guard.ts`
- `canActivate` now wraps `store.hit` in try/catch (`:66-84`). On any store rejection: `logger.warn(...)` including the derived key, then `return true` (ALLOW). Never 500, never blocks.
- Added `private readonly logger = new Logger(RateLimitGuard.name)` (`:26`).
- Store (`redis-rate-limit-store.ts`) unchanged — it still rejects on error; the guard owns the policy (as instructed).
- WHY comment explains the availability trade-off (limiter is a protective edge layer; losing it briefly must not take login/refresh offline).

### H2 — `trust proxy` set deliberately
`apps/gateway/src/main.ts`
- App typed `NestFactory.create<NestExpressApplication>(...)` (`:9`); import added (`:7`).
- `app.set('trust proxy', 1)` (`:19`) — **value 1 = single hop = the Nginx edge**. WHY comment (`:12-18`) ties it to the IP-keyed limiter + Nginx→gateway topology and explicitly rejects `trust proxy: true` (would trust the whole client-controllable XFF chain → spoofable). With `1`, `req.ip` = client's XFF entry Nginx sets, un-spoofable past one hop.

### Health endpoint + rate-limit exemption
- New decorator `apps/gateway/src/rate-limit/skip-rate-limit.decorator.ts`: `@SkipRateLimit()` + `SKIP_RATE_LIMIT_KEY`. Mechanism: **decorator honored by the guard** (not a hardcoded path skip).
- `RateLimitGuard` injects `Reflector` (`:29`) and checks `SKIP_RATE_LIMIT_KEY` via `getAllAndOverride` right after the enabled-check (`:47-54`); marked routes bypass the store entirely.
- New `apps/gateway/src/health/health.controller.ts`: `@Public() @SkipRateLimit() @Controller('health')`, `GET` → `{ status: 'ok' }` (200). Path `/api/v1/health` (matches app `api` prefix + URI version). Trivial by design (no downstream dep checks).
- Registered in `app.module.ts` controllers list (first; distinct `/health` path so order immaterial) + import.

## Tests

Unit — `apps/gateway/src/rate-limit/rate-limit.guard.spec.ts`
- Constructor sig updated to `(store, reflector, config)`; added `reflectorStub()` helper; `contextFor` now exposes `getHandler`/`getClass` (Reflector reads them off the context).
- **M-1 fail-open**: store.hit rejects → guard resolves `true`, `store.hit` called with `rl:ip:...` (IP-key derivation with no `sub`), `Logger.warn` called with the key.
- **Skip**: `@SkipRateLimit` route → guard allows, store never touched.
- Existing sub-key / IP-fallback / 429 / disabled cases retained. Suite green (17 tests, 3 suites).

e2e (WRITTEN, NOT RUN — need Keycloak+Redis)
- **M-1 IP-trip** — `rate-limit.e2e-spec.ts`: hammer public `POST /api/v1/auth/refresh` from one IP past `max` → 429 + Retry-After (guard counts before the controller runs; invalid token irrelevant).
- **M-2 auth-proxy lock** — `authz-matrix.e2e-spec.ts`: `GET` and `POST /api/v1/auth/tenants` with NO token → 401 (proves global guard covers the auth proxy, not just catalog).
- **Health** — `authz-matrix.e2e-spec.ts`: `GET /api/v1/health` no token → 200 `{status:'ok'}` (public + not throttled).
- Redis-down e2e intentionally NOT added (flaky per review guidance); fail-open covered by the unit test above.

## Verification (ran)
- `pnpm nx build gateway` — ✔ webpack compiled successfully.
- `pnpm nx test gateway` — ✔ 3 suites / 17 tests pass.
- `pnpm biome check .` — ✔ clean (1 info = biome-migrate hint, no errors; autofix reflowed 2 long lines).
- `pnpm cruiser` — ✔ no dependency violations (209 modules).
- `pnpm knip --no-config-hints` — ✔ clean (no unused).
- `npx tsc -p apps/gateway-e2e/tsconfig.spec.json --noEmit` — ✔ exit 0 (new e2e typechecks).

## Left for you (NOT run, per instructions)
- Container e2e: `pnpm nx e2e gateway-e2e --testFile=rate-limit.e2e-spec.ts` (Keycloak+Redis+Postgres) and `...=authz-matrix.e2e-spec.ts` (Keycloak+Postgres) — cover M-1 IP-trip, M-2, and health.

## Deviations / notes
- Health path chosen as `/api/v1/health` (under the app's `api` prefix + v1) rather than root `/health`, to stay consistent with the versioned surface and avoid global-prefix-exclusion config. If your k8s/LB probe expects root `/health`, say so and I'll switch to `VERSION_NEUTRAL` + `setGlobalPrefix` exclusion.
- e2e harness (`service-harness.ts`) left unchanged — it does not set `trust proxy`, but the IP-trip e2e still works because the loopback socket IP is constant across requests (same `rl:ip` bucket). Prod trust-proxy behavior is covered by the H2 code + WHY comment; not unit/e2e-asserted (would need a simulated proxy hop).

## Unresolved questions
1. Root `/health` vs `/api/v1/health` — confirm what the deploy target's probe hits.
2. Exact prod proxy topology single Nginx hop assumed (`trust proxy = 1`). If a load balancer sits in front of Nginx too, bump the hop count.

**Status:** DONE
