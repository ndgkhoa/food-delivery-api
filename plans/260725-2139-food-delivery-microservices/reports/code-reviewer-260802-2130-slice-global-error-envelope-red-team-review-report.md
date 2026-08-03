# Red-Team Review — Global Error Envelope slice (`feat/global-error-envelope`)

Scope: `libs/shared/errors/*` (new), 13 `main.ts`, 6 deleted per-service filters, 7 migrated `domain/shared/errors.ts`, `tsconfig.base.json`. Uncommitted working tree.
Verdict: **No Critical. One High (observability, not correctness). Ships after H1 fix.** The two headline hunts — 500 info-leak and gRPC breakage — were both traced to ground: **info-leak = clean; gRPC error propagation = preserved.** Real defect is misleading ERROR-log spam on non-HTTP contexts.

---

## HIGH

### H1 — Catch-all filter is unguarded for non-HTTP execution contexts → misleading ERROR logs on the gRPC saga hot path (+ WS)
`libs/shared/errors/src/global-exception.filter.ts:39-56`

`catch()` calls `host.switchToHttp()` unconditionally and assumes an Express `Response`. But the filter is registered via `app.useGlobalFilters(new GlobalExceptionFilter())` and **catalog + inventory** (the only two hybrid apps — `apps/catalog/src/main.ts`, `apps/inventory/src/main.ts`, both `connectMicroservice(..., { inheritAppConfig: true })`) inherit it onto their gRPC handlers. Delivery's Socket.IO gateway (`apps/delivery/src/interface/ws/delivery.gateway.ts`) inherits it too.

Repro (inventory reserve, a *normal* saga outcome — idempotent replay):
1. order calls inventory `Reserve` with a replayed `orderId` → handler throws `IdempotencyConflictError` → `InventoryGrpcController.toRpcException` wraps it as `RpcException({code: ALREADY_EXISTS})` (`apps/inventory/src/interface/grpc/inventory.grpc.controller.ts:47,68`).
2. Nest `RpcExceptionsHandler.handle` invokes the inherited `GlobalExceptionFilter.catch(rpcException, host)`.
3. `RpcException` is not `HttpException`/`DomainException`/`TypeOrmEntityNotFoundError` → **unknown branch** (`filter:82-87`) logs `ERROR unhandled exception on ? ?: <RpcException stack>` — i.e. a routine ALREADY_EXISTS is logged as an *unhandled fault*.
4. `respond()` (`filter:59-65`) then calls `response.status(...)` on the gRPC `Metadata` object (which has no `.status`) → `TypeError` → caught by the inner try/catch → second `ERROR failed to write error envelope: ...`.
5. `catch` returns `undefined`; verified in installed source `@nestjs/microservices/exceptions/rpc-exceptions-handler.js:16-22` — `if (filterResult$) return; return super.catch(...)` → Nest **falls through** to `BaseRpcExceptionFilter`, which serializes the original `RpcException` correctly.

Net: gRPC status codes (`ALREADY_EXISTS`/`ABORTED`/`INVALID_ARGUMENT`/`UNAUTHENTICATED`) **are preserved** (functional correctness intact — the inventory e2e `apps/inventory-e2e/src/inventory-grpc-reserve.e2e-spec.ts:145-155` still `.rejects`). The damage is **two spurious ERROR logs per gRPC error on the saga hot path** — lock-contention retries (`ABORTED`) and idempotent replays (`ALREADY_EXISTS`) are expected control-flow, not faults. This pollutes error dashboards, can trip ERROR-rate alerts, and masks genuine errors. Same path fires for catalog's `GrpcTenantContextInterceptor` UNAUTHENTICATED (`apps/catalog/src/interface/grpc/grpc-tenant-context.interceptor.ts:33`) and any unexpected throw from delivery's WS handlers (`delivery.gateway.ts:123,126`).

Regression vs. old code: the deleted per-service filters used **scoped** `@Catch(SpecificError)`, so gRPC errors never matched them and flowed straight to Nest's RPC handler cleanly. The new `@Catch()` catches everything, including RPC/WS.

Fix (one line, fixes gRPC + WS at once):
```ts
catch(exception: unknown, host: ArgumentsHost): void {
  if (host.getType() !== 'http') return; // let Nest's RPC/WS handler serialize it
  const ctx = host.switchToHttp();
  ...
}
```
Early-return yields `undefined` → same Nest fallthrough → RPC/WS error serialized correctly, with **no** spurious logs and no wasted work. (Severity is observability/hot-path, not data/correctness — flagged High for certainty + saga-hot-path + it was the primary hunt; downgrade to Medium if you weigh it purely by functional impact.)

---

## MEDIUM

### M1 — Test gap hides H1: the spec only ever exercises an HTTP host
`libs/shared/errors/src/global-exception.filter.spec.ts:18-32`

`buildHost` always returns a `switchToHttp()` that yields a mock Express response, and the filter never calls `host.getType()`. So every branch is tested **only** in HTTP context; there is zero coverage for the gRPC/WS execution context that produces H1. This is exactly why the defect passes CI. Add a case with `host.getType() → 'rpc'` (and a `getResponse()` returning a non-Express object) asserting the filter no-ops (no `logger.error`, no `response.status` call). Otherwise coverage looks complete while the real-world path is untested.

### M2 — Backwards-compat: `error` field semantics changed for order/review + custom-HttpException `error` bodies dropped
`libs/shared/errors/src/http-error-mapping.ts:22-24`, `global-exception.filter.ts:47`

The old order/review filters returned `error: <ClassName>` (e.g. `"OrderNotFoundError"`); the envelope now derives `error` from the status reason phrase (`"Not Found"`). Intended per plan (machine identity moved to `code`), but any client parsing `error` breaks. Separately, `normalizeHttpExceptionResponse` only passes through `body.code` — it ignores a custom HttpException's own `error` field. Concrete: gateway `apps/gateway/src/session/keycloak-oidc.client.ts:93` throws `new HttpException({ statusCode, error: oauthError }, status)`; post-slice `oauthError` appears in neither `code` nor `error` (overwritten by reason phrase), and `message` becomes `"Http Exception"`. No leak, but the OAuth error detail is silently lost. Confirm no consumer depends on `error`/`oauthError`; document the break in the PR.

---

## LOW

- **L1** — A raw TypeORM `EntityNotFoundError` (e.g. `findOneOrFail`) now maps to 404 (`filter:79-81`); pre-slice it fell to Nest's default 500. Behavior change (an improvement), but a status change worth noting if any e2e asserted 500.
- **L2** — `reasonPhrase` returns the literal `"Error"` for any 4xx code absent from Nest's `HttpStatus` enum (`http-error-mapping.ts:30-31`). Cosmetic; unlikely in practice.
- **L3** — Filter is instantiated per service (`new GlobalExceptionFilter()`); stateless, fine. No action.

---

## Verified CLEAN (headline hunts traced to ground)

- **500 info-leak — CLEAN.** Unknown branch returns the constant `"Internal server error"` (`filter:16,87`); `describeError` (stack) is used **only** in `logger.error` (`filter:63,84`), never in the body. `QueryFailedError`/raw `Error` → unknown branch → generic 500. Unit test `spec:117-128` asserts `"hunter2"` never appears. Keycloak `SECRET`-detail concern: `apps/auth/src/infrastructure/keycloak/keycloak-admin-http.adapter.ts:118-123` logs the raw upstream body server-side and throws `KeycloakAdminError('Upstream identity provider error', 502)` — curated message only. **No `DomainException` in the repo has `httpStatus: 500`** (all 400/403/404/409/422/502), so the DomainException branch cannot echo internal detail. No `InternalServerErrorException(detail)` anywhere.
- **Status codes — ALL PRESERVED** vs. deleted `statusFor`/`classify` switches: order 404/409/422/403/400 ✓; auth EntityNotFound 404 / Conflict 409 / InvalidUuid 400 / KeycloakAdminError dynamic 409·400·502 ✓ (`error` reason phrase matches: 502→"Bad Gateway", 409→"Conflict"); config 404/404/403 ✓; media 404/400/409 ✓; review 404/403/409/400 ✓; catalog 404 ✓.
- **Deleted `InsufficientStockError` — TRULY dead in order.** Zero references in `apps/order/src` (grep). It survives and is actively used in inventory (`apps/inventory/src/application/reservation/commands/reserve-stock.handler.ts:131,173`). The real order path is gRPC `MenuValidationError`/the Kafka `StockReservationFailed` reply — reviewer's claim confirmed. Safe deletion.
- **ValidationPipe `string[]` preserved** — `normalizeHttpExceptionResponse` returns `body.message` untouched (`spec:83-103`). No `[object Object]`.
- **never-throw** — `respond` wraps the write in try/catch (`filter:59-65`); `spec:141-156` proves it. `readCorrelationId` is undefined-safe (`filter:90-93`).
- **Non-Nest Kafka consumers unaffected** — order/payment/notification/review/etc. run Kafka via provider bootstrap hooks (raw KafkaJS), not Nest transport, so the filter never touches those message handlers.
- **Housekeeping** — no orphaned refs to any deleted filter class; all `filters/` dirs removed; alias registered (`tsconfig.base.json`); `project.json` tags `scope:shared`/`type:util`; `index.ts` exports the public surface only.

---

## Checklist
Concurrency: n/a (stateless filter). Error boundaries: ✓ (never-throw verified) except H1 log noise. API contracts: DomainException `code`+`httpStatus` honored; M2 `error`/`oauthError` break. Backwards-compat: M2. Input validation: n/a. Auth/authz: unchanged (401/403 preserved). N+1: n/a. Data leaks: CLEAN.

## Unresolved questions
1. Is any client (mobile/web) parsing the response `error` field, or has it fully migrated to `code`? Determines whether M2 is breaking in practice.
2. Does the plan's "update affected service specs/e2e to the new shape" (todo #4) have remaining work? No test files are modified in this diff and no e2e was found asserting the old `error` body — confirm none exist elsewhere before merge.
3. H1: accept the one-line `getType()` guard now, or defer as known log-noise? Recommend fixing now — it's on the saga hot path.

**Status:** DONE_WITH_CONCERNS
**Summary:** No Critical/leak; status codes + gRPC propagation preserved. One High: catch-all filter unguarded for non-HTTP contexts spams misleading ERROR logs on the gRPC saga hot path + WS — one-line `host.getType() !== 'http'` guard fixes it. Plus a test gap (M1) that hides it and a documented `error`-field compat break (M2).
**Concerns/Blockers:** H1 should be fixed before merge (hot-path observability); M1 test should accompany the fix so CI catches regressions.
