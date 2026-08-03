# DLQ-replay tool for escalated order-sagas

Context: [plan.md](./plan.md) · [backlog-single-image-food-delivery-api.md](./backlog-single-image-food-delivery-api.md)

## Overview
- **Priority**: last remaining code follow-up. The saga reaper escalates a saga at `attempts >= SAGA_RECONCILER_MAX_ATTEMPTS` (ERROR log + `saga_reconcile_escalated` metric) and leaves it. It stays non-terminal → re-selected + **re-escalated every sweep forever** until an operator intervenes. Needed a tool to re-drive an escalated saga after the root cause is fixed.
- **Status**: ✅ Implemented + reviewed — branch `feat/saga-replay-escalated`, PR #57. Awaiting CI-green merge → sync main → release-please cuts **v1.2.0**.

## Design (KISS: reuse the existing idempotent reaper, add no new re-drive path)
- **Endpoint**: `POST /orders/sagas/:orderId/replay` (`SagaAdminController`). Resets the saga's `attempts` to 0 so the **next reaper sweep** re-drives it through the existing idempotent recovery (reserve/charge/release by order id). Never re-implements command emission.
- **Repo**: `resetReconcileAttempts(tenantId, orderId): 'reset' | 'terminal' | 'not_found'` — a single conditional `UPDATE ... SET attempts=0 WHERE tenant_id AND order_id AND state IN (non-terminal)`; 0-rows disambiguated by a tenant-scoped lookup. Deliberately does NOT bump `updated_at` (the reaper selects on `updated_at < now-timeout`; bumping it would skip the saga for a full timeout window — the replay must be effective on the very next sweep).
- **AuthZ**: method-scoped `@UseGuards(RolesGuard)` + `@Roles('admin','platform-admin')` — the order app keeps its no-global-guard posture; every other route unchanged. Roles come from the signature-verified identity (`TrustedIdentityInterceptor` global APP_INTERCEPTOR verifies the HMAC over `tenantId,sub,roles,ts` — a forged `x-roles` 401s). Reset is tenant-scoped, so a tenant `admin` only ever replays their own tenant's sagas; `platform-admin` matches the config service's operator split.
- **Status mapping**: `reset`→200 `{orderId, outcome:'reset'}`; `not_found`→404; `terminal`→409.

## Adversarial review — SHIP, no Critical/High
Auth/tenant isolation VERIFIED SAFE (guard+interceptor compose; cross-tenant reset impossible via tenant-scoped WHERE + signed x-tenant-id). All races closed by `state IN (non-terminal)` guard + relative-vs-absolute atomic UPDATEs (no terminal resurrection, no corruption either ordering). Findings addressed before merge:
- **M1 (fixed)**: reset bumped `updated_at=now()` → replayed saga skipped for one full `SAGA_REAPER_TIMEOUT_MS`, contradicting the "next sweep" contract. Dropped the bump.
- **M2 (fixed)**: repo unit test didn't assert the `state IN (non-terminal)` guard (no-op fake QB) — a regression dropping it would pass green. Now asserts the `state IN` SQL + `states`/tenant params.
- **L1 (addressed)**: `admin` is tenant-scoped, not platform-operator; comment overclaimed "never opened to a tenant's own callers". Widened to `admin`,`platform-admin` + corrected the comment to state the tenant-scoped guarantee.

## Related files
- NEW `apps/order/src/interface/http/saga-admin.controller.ts` (+ spec), `apps/order/src/domain/saga/order-saga.repository.ts` (port), `apps/order/src/infrastructure/persistence/repositories/typeorm-order-saga.repository.ts` (+ spec), `apps/order/src/application/saga/saga-reply-test-doubles.ts` (+ spec), `apps/order/src/app.module.ts` (register controller), `place-order.handler.spec.ts` (port stub).

## Todo
- [x] repo method + port + in-memory test-double (three-way outcome)
- [x] admin/platform-admin endpoint, tenant-scoped, status mapping
- [x] tests: repo (reset/terminal/not_found + guard/tenant asserted), test-double (+cross-tenant), controller (admin/platform-admin 200, non-admin 403, no-identity 401, 404, 409 — real RolesGuard)
- [x] adversarial review (SHIP); M1/M2/L1 addressed
- [ ] merge #57 on CI-green → sync develop→main → release-please **v1.2.0**

## Success criteria
- An escalated saga stops re-escalating after an operator POSTs replay; the next reaper sweep re-drives it; a terminal saga → 409, unknown → 404, cross-tenant → 404.

## Next steps
Merge #57 → sync main (release-please cuts v1.2.0). Blocked-on-user: delete 13 old GHCR packages (needs `gh auth refresh -s read:packages -s delete:packages`).
