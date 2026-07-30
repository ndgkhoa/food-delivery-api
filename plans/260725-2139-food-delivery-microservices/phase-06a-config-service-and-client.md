# Slice 6a — Config service + shared config-client (+ order consumes it)

Context: [phase-06.md](./phase-06-analytics-review-config.md) · [phase-02.md](./phase-02-order-core-inventory.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P2 — first P6 slice (foundational; review 6b + analytics 6c build later).
- **Status**: ✅ PR-A verified live (adversarial review in progress) on `feat/config-service`. config-e2e **6/6** GREEN against real Postgres + Kafka: value CRUD, tenant override beats global, flag toggle, non-admin write → 403, and cache-miss-fetch → `config.events` change → client evict → refetch-new-value. Migration ran via the new `nx run config:migration-run` target (confirms the DRY migration refactor for a fresh service). Offline: config **22** unit + shared-config-client **13** + gateway **30** (unaffected) + tsc/biome/depcruise/knip/webpack. **Fix during live verify**: the config-events consumer used a fresh random group at `latest` → missed a change produced during the Kafka assignment window → set `fromBeginning: true` (per the repo's e2e-consumer pattern; replay is a no-op for eviction, so a change is never missed).
- **Adversarial review + fixes applied** (report `reports/code-reviewer-260729-2237-slice-6a-config-service-red-team-review-report.md`; NO Critical — partial-unique indexes, falsy-value resolution (`0`/`false` win), tenant-from-verified-identity (no spoof), cross-tenant cache isolation, payload-based eviction all confirmed SOLID):
  - **H1 (High)** — config-client's 3s timeout cleared when headers arrived, so a stalled response BODY hung `getInt`/`isEnabled` → blocked the order path (breaks the never-hard-dependency guarantee; same class as 5c's H1). **Fixed**: fetch + `res.json()` read under one AbortController.
  - **M1** — a corrupt 200 body (non-numeric value / non-boolean flag) was cached + served for the TTL. **Fixed**: validate finite number / boolean → else WARN + caller default, never cached (unit-tested).
  - **M2** — value DTO had no upper bound → an oversized-but-integer input threw a 500. **Fixed**: `@Max(Number.MAX_SAFE_INTEGER)` → 400 (also closes the L3 precision note).
  - Deferred (documented): L1 (409 mapping on a concurrent-first-write race — currently 500, rare), L2 (`evictAllForKey` `endsWith(':'+key)` can over-evict → extra refetch, fail-safe). Trust-boundary note: the config service port must stay inside the mesh (gateway-stamped-identity model) — tracked in the plan's existing "internal identity trust hardening" backlog (P8).
- **PR-B ✅ verified live (adversarial review in progress)** — branch `feat/order-config-pricing`. The order aggregate now computes `total = subtotal + deliveryFee + floor(subtotal×vat_bps/10000) − discount` (floored ≥ 0) from config-client-sourced tunables at place-order time; migration adds + backfills the 4 columns (`subtotal_cents = total_cents`, others 0 for existing rows) + 4 non-negative CHECKs. Live evidence: config-pricing e2e (tenant fee 2500 → order subtotal 2400 / fee 2500 / vat 240 / total **5140**, VAT+discount via the client default fallback for unset keys) — DB-confirmed; saga happy-path **2/2** (PENDING→CONFIRMED on the new full total + 100-concurrent no-oversell) + compensation **6/6** (decline on the actual charged total) + in-process testcontainers **3/3** (migration applies) + order unit **66**. All offline gates green. The `ChargePayment` saga contract is unchanged (already carried `totalCents`, now the full total).
- **Adversarial review + fixes applied** (report `reports/code-reviewer-260730-0733-slice-6a-order-pricing-red-team-review-report.md`; NO Critical — money arithmetic correct in-range, config-never-blocks-order via `Promise.all`, persistence round-trip, and saga-total flow all confirmed SOLID):
  - **H1 (High)** — `MAX_MONEY_CENTS` guarded only the final total, but each component sits in its own int4 column while the config DTO accepted up to `MAX_SAFE_INTEGER`: a huge fee + huge discount that net to an in-range total passed the guard, then overflowed its int4 column on insert → raw `QueryFailedError` → uncaught 500 → tenant placement outage. **Fixed** two ways: `Order.create` now bounds EACH persisted component (subtotal/fee/vat/discount/total) ≤ `MAX_MONEY_CENTS` → clean `InvalidOrderRequestError` (regression-tested); and the config value DTO cap tightened `MAX_SAFE_INTEGER` → int4 max (2_147_483_647) so an oversized value can't be stored in the first place.
  - **M1 (Medium, business decision — NOT reversed)** — an over-discount floors the total to 0 → a legitimately free order charged 0. Kept the behavior (a full-value promo is valid); added an observability WARN when a discount floors the total to 0 so a mis-set discount isn't invisible.
  - Deferred (documented): L2 migration ops note (full-table `UPDATE` + `ADD CONSTRAINT` hold ACCESS EXCLUSIVE on `orders`; fine at current scale, revisit for a staggered rollout / large table).
- **Delivery = TWO PRs** (money-touching change kept reviewable):
  - **PR-A**: the `config` service + `libs/shared/config-client` — verified standalone (CRUD + flags + change-event → client cache invalidation).
  - **PR-B**: `order` consumes config pricing — adds delivery-fee/VAT/discount to the order total via the config-client (+ orders migration + e2e: change the fee → new order total reflects it).
- **Brief**: A `config` service owns the business TUNABLES (delivery fee, VAT rate, discount) as tenant-overridable values, plus a separate feature-flag store (boolean toggles). Writes are admin-only and emit `config.events` so a shared **config-client** library (read-through cache + TTL + event invalidation) stays fresh. `order` then computes its total from config instead of items-only — change the delivery fee in config and the next order reflects it, no redeploy.

## Key decisions
- **Two concerns, NOT conflated** (the plan's explicit rule): **config values** = business numbers (`config_entries`); **feature flags** = boolean switches (`feature_flags`). Separate tables + separate API paths.
- **`config` service** (new Nx HTTP app, scope `config`, own `config` Postgres DB) mirrors catalog's hexagonal shape. Admin-only writes (role check via the verified identity), tenant-scoped, audit via existing shared-audit if wired. On every write it emits a `config.events` message (`ConfigValueChanged` / `FeatureFlagChanged`) carrying `{tenantId|null, key}`.
- **Tenant override model**: `config_entries(id, tenant_id NULL-able, key, value BIGINT, updated_at)`, unique `(tenant_id, key)`. `tenant_id IS NULL` = the GLOBAL default; a tenant row overrides it. Resolution = tenant row ?? global row ?? caller default. Values are integers (cents / basis-points) — all three tunables are integers; a jsonb value is YAGNI now. Flags: `feature_flags(id, tenant_id NULL-able, key, enabled BOOL, updated_at)`, same override rule.
- **Change events, best-effort + TTL safety net** (NOT a full outbox): config writes are low-frequency admin actions and the client tolerates brief staleness, so the service emits `config.events` via a direct Kafka producer on write, and the **config-client caches with a short TTL** as the self-healing fallback if an invalidation is ever missed. (Outbox is overkill here; documented trade-off. If exactly-once invalidation is ever needed, add the outbox then.)
- **`libs/shared/config-client`** (new lib) — the READ side other services use:
  - `getInt(key, tenantId, default)` / `isEnabled(key, tenantId, default)`: read-through cache keyed by `tenant+key`, TTL (e.g. `CONFIG_CACHE_TTL_MS=30000`), fetched from the config service HTTP API.
  - Subscribes to `config.events` (Kafka) and EVICTS the changed key on a message → near-instant propagation; the TTL covers a missed event.
  - **Never a hard dependency**: if the config service is unreachable AND the cache is cold, it returns the caller-supplied `default` (logged WARN) so a place-order never blocks on config being down.
  - Needs a new commit scope `shared-config-client` (add to `commitlint.config.mjs` scope-enum) + Nx tag `scope:shared-config-client` + dependency-cruiser allowances.
- **Order pricing model** (PR-B): the order aggregate gains `subtotalCents` (sum of lines, today's `totalCents`), `deliveryFeeCents`, `vatCents`, `discountCents`, and `totalCents = subtotal + deliveryFee + vat − discount` (floored at 0). `vat = floor(subtotal × vat_rate_bps / 10000)`. Config keys + seeded global defaults (tenant-overridable): `order.delivery_fee_cents` (1500), `order.vat_rate_bps` (1000 = 10%), `order.discount_cents` (0). Read for the order's tenant in `place-order.handler.ts` and passed into `Order.create`. The saga's `ChargePayment` already carries `totalCents` → payment now charges the full total; no order-saga contract change.

## Requirements
**Functional (PR-A)**: `config` service CRUD for values (`GET/PUT /api/v1/config/:key`, list) + flags (`GET/PUT /api/v1/config/flags/:key`), tenant-scoped with a global default, admin-only writes; each write emits `config.events`. `config-client`: resolve a value/flag (tenant→global→default) via read-through cache; evict on the change event.
**Functional (PR-B)**: `order` computes total from config-sourced fee/VAT/discount; changing a config value changes the NEXT order's total.
**Non-functional**: config reads cached (client TTL), invalidate on change; flag/value stores separate; config never a hard dependency (default fallback); resolution deterministic (tenant override wins); admin-only + tenant isolation on writes.

## Architecture / data flow
```
admin ─PUT /api/v1/config/order.delivery_fee_cents {value}──▶ config svc (role=admin, tenant-scoped)
        └─ upsert config_entries(tenant_id?,key,value) ─▶ emit config.events{ConfigValueChanged, tenantId?, key}
config.events (Kafka) ─▶ config-client (in each consumer) evicts cache[tenant+key]

order place-order ─▶ configClient.getInt('order.delivery_fee_cents', tenantId, 1500)
                     configClient.getInt('order.vat_rate_bps', tenantId, 1000)
                     configClient.getInt('order.discount_cents', tenantId, 0)
        └─ Order.create({items, deliveryFeeCents, vatRateBps, discountCents})
             total = subtotal + fee + floor(subtotal*vatBps/10000) − discount   (≥ 0)
   (client cache: hit → return; miss → GET config svc; svc down + cold → caller default, WARN)
```

## Related code files
**PR-A — create `apps/config/`** (mirror catalog's hexagonal app): project.json (`scope:config,type:app`), tsconfig*, jest, webpack, main.ts (:3008, prefix `api/v1`, pino, shutdown).
- `config/config-env-schema.ts` — DB_* (own `config` DB), KAFKA_BROKERS/CLIENT_ID, PORT 3008.
- `domain/config/*` — `ConfigEntry` + `FeatureFlag` models, repository ports, `config-event.ts` types, resolution rule (tenant ?? global).
- `application/*` — get/list/upsert value, get/upsert flag handlers (admin-role guard); emit change events.
- `infrastructure/persistence/*` — entities + repos + migration `*-create-config-entries-and-feature-flags.ts` (unique `(tenant_id,key)` each; index key).
- `infrastructure/messaging/*` — `config-event.publisher.ts` (Kafka producer → `config.events`).
- `interface/http/config.controller.ts` + DTOs (admin-only via shared-tenancy identity role check).
- `infra/docker-compose.yml` `01-create-service-databases.sh` (+`config` DB), `.env.example`, `package.json` (`config` in dev; add `migration-run/generate/revert: {}` opt-in markers to `apps/config/project.json` per the nx migration convention), `apps/gateway/*` (proxy `/api/v1/config/*` + a `config-proxy.controller.ts` + `CONFIG_SERVICE_URL` env + a breaker `serviceName:'config'`).
- **`libs/shared/config-client/`** — lib scaffold (project.json `scope:shared-config-client,type:util`), `config-client.ts` (read-through cache + TTL), `config-events.consumer.ts` (evict), `config-client.module.ts` (Nest dynamic module: `forRoot({configServiceUrl, ttlMs})`). Add scope to commitlint + dependency-cruiser tag rules.
- `apps/config-e2e/` — CRUD a value → client reads it (miss→fetch) → update via API (emits event) → client evicts → next read = new value; tenant override beats global; flag toggle; admin-only rejects non-admin.

**PR-B — modify `order`:**
- `domain/order/order.ts` — add `subtotalCents/deliveryFeeCents/vatCents/discountCents`; `create()` takes a pricing input; compute the total per the model; `MAX_MONEY_CENTS` guard on the final total.
- `domain/order/order.mapper.ts` + entity + migration `*-add-order-pricing-columns.ts` (subtotal_cents, delivery_fee_cents, vat_cents, discount_cents; backfill existing rows: subtotal=total, others 0).
- `application/order/commands/place-order.handler.ts` — inject `ConfigClient`, read the 3 keys for the tenant, pass into `Order.create`.
- `apps/order/src/app.module.ts` — import `ConfigClientModule.forRoot(...)`; `order-env-schema.ts` — `CONFIG_SERVICE_URL`, `CONFIG_CACHE_TTL_MS`.
- order-e2e — change delivery fee via the config API → place order → total = subtotal + fee + vat − discount.

## Implementation steps (PR-A first)
1. Scaffold `apps/config` (+ its Postgres) mirroring catalog; migration `config_entries` + `feature_flags`.
2. Domain resolution (tenant ?? global ?? default) + repos; admin-guarded CRUD handlers; `config.events` publisher on write.
3. HTTP controller + DTOs; gateway proxy `/api/v1/config/*` (+ breaker serviceName 'config'); compose/db-init/.env/dev/migrate-opt-in markers.
4. `libs/shared/config-client` — read-through TTL cache + `config.events` evict consumer + Nest module + default fallback. commitlint scope + cruiser rules.
5. **E2E (PR-A)**: value CRUD + cache-miss-fetch + change-event evict + tenant-override + flag + admin-only.
6. Offline gates + unit tests; update plan; **PR-A**.
7. **(PR-B, after A merges)** order pricing model + migration + place-order reads config-client + order-e2e; gates; PR-B.

## Todo (PR-A)
- [x] `apps/config` scaffold (HTTP + Postgres) + env schema
- [x] `config_entries` + `feature_flags` migration + repos + tenant/global resolution
- [x] admin-guarded CRUD (values + flags) + `config.events` publisher on write
- [x] gateway proxy `/api/v1/config/*` (+ breaker serviceName) + compose/db-init/.env/dev/migration opt-in
- [x] `libs/shared/config-client` (read-through TTL cache + event evict + default fallback) + commitlint scope + cruiser rules
- [x] E2E: value CRUD + cache invalidation on change + tenant override + flag + admin-only (gated behind `RUN_CONFIG_E2E=1`, needs live verification)
- [x] biome/cruiser/knip/tsc + unit tests; plan updated before push

## Todo (PR-B)
- [ ] order pricing model (subtotal/fee/vat/discount/total) + migration (+ backfill)
- [ ] place-order reads config-client (fee/vat/discount) for the tenant
- [ ] order-e2e: change fee in config → next order total reflects it
- [ ] gates + plan update; PR-B

## Success criteria
- Admin sets `order.delivery_fee_cents` (global or per-tenant); a NEW order's total = subtotal + fee + VAT − discount and changes when the config changes — no redeploy.
- A tenant override beats the global default; a feature flag toggles a boolean without redeploy.
- config-client serves cached reads, evicts on the change event, and falls back to the caller default when config is unreachable (never blocks an order).
- Value and flag stores are separate; writes admin-only + tenant-isolated.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Config a hard dependency → orders blocked if config down | M×H | config-client TTL cache + caller-default fallback (WARN), never throws on a cold miss |
| Cache staleness after a change | M×M | `config.events` evict + short TTL backstop |
| Money-math regression in order total | M×H | pure domain calc + unit tests (fee/vat/discount/floor); migration backfills subtotal=total; PR-B isolated from PR-A |
| Flag/value conflation | L×M | separate tables + APIs; enforced in the domain |
| Missed change event → stale until TTL | M×L | acceptable (documented); TTL bounds staleness |
| Non-admin writing config | L×H | admin-role check on the verified identity; e2e asserts rejection |

## Security considerations
- Config/flag WRITES admin-only (role from the verified gateway identity), tenant-scoped; a tenant can't write another tenant's override or the global default (global write = platform-admin only).
- Reads tenant-scoped; no cross-tenant value/flag leakage in the client cache (cache key includes tenantId).
- Feature flags cannot express an auth-bypass (flags gate business behaviour only) — documented invariant.
- `config.events` carries only `{tenantId?, key}` (no secret values); the client re-fetches the value over the authenticated internal path.

## Next steps
6b review→rating→search + 6c analytics build on the same event backbone. Config becomes the tunable source other services read (delivery pricing, later promo/discount rules). Real admin UI + audit dashboards are P8.
