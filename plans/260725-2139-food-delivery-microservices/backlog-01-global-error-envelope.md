# Backlog 01 — Global error envelope (shared GlobalExceptionFilter)

Context: [plan.md](./plan.md) (Deferred backlog) · [architecture.md](./architecture.md)

## Overview
- **Priority**: correctness/consistency — first backlog slice after P0–P8.
- **Status**: ✅ Verified live (HTTP envelope) + adversarially reviewed (1 High + 2 Medium fixed) — branch `feat/global-error-envelope`. Single PR. `libs/shared/errors` (`GlobalExceptionFilter` catch-all + `DomainException` base) wired into all 13 services; 6 legacy per-service filters deleted; every service's domain errors migrated to `extends DomainException` with preserved status codes.
  - **Live evidence (gateway, standalone)**: `GET /api/v1/does-not-exist` → `{statusCode:404, error:"Not Found", message, correlationId, timestamp, path}`; `GET /api/v1/orders` (no JWT) → `{statusCode:401, error:"Unauthorized", message:"Missing bearer token", correlationId, ...}` — unified envelope, a supplied `x-correlation-id` is echoed (auto-generated when absent), no internal leak. Offline: shared-errors **8** + all 40 project suites green; tsc/biome/dependency-cruiser (907 modules, 0 violations)/knip clean.
- **Adversarial review + fixes applied** (report `reports/code-reviewer-260802-2130-slice-global-error-envelope-red-team-review-report.md`; **NO Critical** — both headline hunts traced clean: the unknown→500 branch returns a CONSTANT message and never echoes `exception.message`/stack [the real error is logged server-side only]; all domain-error status codes verified preserved vs the deleted `statusFor` switches; `InsufficientStockError` truly dead in order):
  - **H1 (High)** — the catch-all filter called `switchToHttp()` unconditionally, but catalog + inventory register it globally with `inheritAppConfig:true`, so their gRPC/Kafka errors routed through it too. Nest's RPC handler still propagates correctly (the filter returning undefined falls through to `super.catch`), so it was NOT a correctness break — but every routine gRPC saga error (`ALREADY_EXISTS`/`ABORTED`) emitted TWO misleading ERROR logs on the hot path. **Fixed**: `if (host.getType() !== 'http') return;` — skips non-HTTP contexts entirely (also covers delivery's WS).
  - **M1 (Medium)** — the filter spec only exercised an HTTP host → zero coverage for the non-HTTP path that hid H1. **Fixed**: added a `getType:'rpc'` test asserting the filter skips (no `switchToHttp`, no log) + `getType:'http'` added to the existing host mocks.
  - **M2 (Medium)** — the envelope's `error` is now the reason phrase (intended), which DROPPED the gateway Keycloak client's custom `HttpException({error: oauthError})` — the OAuth2 code (`invalid_grant`/`invalid_request`) the client needs to decide re-auth. **Fixed**: the Keycloak client now throws `{ statusCode, code: oauthError, message }` so the OAuth code survives in the unified `code` field.
  - Low/documented: TypeORM `EntityNotFoundError` now 404 (was Nest's default 500 — an improvement); `reasonPhrase` fallback for an unmapped 4xx.
- **Brief**: Every service currently has its OWN ad-hoc exception filter with an INCONSISTENT JSON shape (catalog `error:'Not Found'` vs order `error:<ClassName>`; none carry correlationId/timestamp/path; unknown errors leak Nest's default 500). Introduce ONE shared `GlobalExceptionFilter` (in a new `libs/shared/errors`) that maps EVERY response (400/401/403/404/409/422/500) to a single envelope — including the correlationId already plumbed since P0 — and a `DomainException` base so domain errors carry their own `code`+`httpStatus` (no per-service status switch). No behaviour change beyond the unified shape + no-leak 500.

## Key decisions
- **Envelope shape** (one for all responses):
  ```json
  { "statusCode": 404, "error": "Not Found", "code": "ORDER_NOT_FOUND",
    "message": "order ... not found", "correlationId": "<uuid>",
    "timestamp": "<ISO>", "path": "/api/v1/orders/123" }
  ```
  `error` = the HTTP reason phrase (consistent, derived from status). `code` = a stable machine code, present for `DomainException` (+ passthrough for HttpExceptions that set one); omitted otherwise. `message` = human string, or `string[]` for validation. `correlationId` from the `x-correlation-id` header (shared-logging middleware sets it); `path` from the request.
- **`DomainException` base** (`libs/shared/errors`): `abstract class DomainException extends Error { abstract readonly code: string; abstract readonly httpStatus: number }`. Each existing domain error (`apps/*/domain/shared/errors.ts`) extends it with its `code`+`httpStatus` — the filter reads those directly, deleting each per-service `statusFor()` switch.
- **`GlobalExceptionFilter`** (`@Catch()` — catches everything), maps in order: `DomainException` → its `httpStatus`+`code`; Nest `HttpException` (ValidationPipe 400, guards 401/403, 404, etc.) → its status + normalized message (unwrap the `{message}` object / string[] array); TypeORM `EntityNotFoundError` → 404; anything else → 500 with a GENERIC message (never leak the internal error string) + `logger.error` the real error. Never throws inside the filter.
- **Registration**: `app.useGlobalFilters(new GlobalExceptionFilter())` in every app `main.ts` (all 13 + gateway). DELETE the per-service filters (auth/catalog/config/media/order/review) and their `app.module.ts`/`main.ts` wiring once their domain errors extend `DomainException`. The gateway (edge) gains the same filter so proxied/edge errors share the shape.
- **Tenant/PII safety**: no tenant data or internal stack in the body; 500s are generic; the real error is logged (with correlationId) server-side only. Auth/identity errors keep their existing status (401/403).
- **Tests**: a shared-errors unit test (each branch → correct status + envelope + no leak on unknown); update any service e2e/unit that asserts the OLD error body shape (catalog `error:'Not Found'`, order `error:<ClassName>`) to the new envelope.

## Related code files
- `libs/shared/errors/*` — new lib: `domain-exception.ts` (base), `global-exception.filter.ts`, `error-envelope.ts` (type), `index.ts`. Register (alias, tags, commitlint scope `shared-errors`, knip). It may reuse the correlation-id header constant from `shared-logging`.
- `apps/*/domain/shared/errors.ts` (auth, catalog, order, review, + any others) — extend `DomainException`, add `code`+`httpStatus` per error.
- `apps/*/interface/http/filters/*` — DELETE the per-service domain/entity filters (catalog `entity-not-found`, order/review/auth `*-domain-error`, config `config-exception`, media `media-exception` — inspect each; if one maps NON-domain framework exceptions, fold that into the shared filter or keep a thin service-specific `@Catch` that still emits the shared envelope via a shared helper).
- `apps/*/src/main.ts` (13) — `useGlobalFilters(new GlobalExceptionFilter())`; remove old filter wiring. `apps/*/src/app.module.ts` — remove `APP_FILTER` providers for the deleted filters.
- Tests: `libs/shared/errors/*.spec.ts` + update affected service specs/e2e.

## Todo
- [x] `libs/shared/errors`: `DomainException` base + `GlobalExceptionFilter` (DomainException/HttpException/ORM-EntityNotFound/unknown→500-no-leak) + envelope type + correlationId/timestamp/path; registered
- [x] migrate domain errors in each service to extend `DomainException` (code + httpStatus); delete per-service `statusFor` switches
- [x] register the shared filter in all 13 main.ts; delete per-service filters + their APP_FILTER wiring
- [x] unit: every branch → correct status + unified envelope + unknown error does NOT leak internals; update affected service specs/e2e to the new shape
- [x] biome/cruiser/knip/tsc + tests green; plan updated before push

## Success criteria
- Every service returns the SAME error envelope shape for 400/401/403/404/409/422/500, including correlationId + path + timestamp.
- An unhandled/unknown error returns a generic 500 (no internal message/stack leaked) and is logged server-side with the correlationId.
- Domain errors map to their status via `DomainException.httpStatus` (no per-service switch); the per-service filters are gone.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Shape change breaks clients/e2e asserting old body | M×M | Update all affected specs/e2e; the envelope is a superset (keeps statusCode+message) |
| A per-service filter caught a framework exception the shared one misses | M×M | Inspect each filter before deleting; the shared `@Catch()` catches everything incl. HttpException |
| 500 leaks internals | L×H | Unknown branch returns a generic message; real error only in server logs |
| Validation 400 message array shape lost | M×L | Normalize HttpException `{message: string|string[]}` into the envelope `message` |

## Next steps
Backlog 02 — Order saga reconciler (sweep stranded PENDING orders). Then optimistic locking, security hardening (internal identity HMAC + prod Keycloak realm), then D-items (Argo, cosign, k6, BullMQ propagation).
