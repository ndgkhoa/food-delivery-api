# Phase 6 — Analytics, Review, Config

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P2
- **Status**: 🔄 In progress — **6a** [config service + client](./phase-06a-config-service-and-client.md) done (#21 config+client · #22 order fee/VAT/discount); **6b** [review → rating → search](./phase-06b-review-rating-search.md) done (#23 order restaurantId · #24 review→rating→search/catalog); **6c** [analytics ClickHouse](./phase-06c-analytics-clickhouse.md) in progress.
- **Brief**: Three event-consuming services that complete the domain: `analytics` (Kafka→ClickHouse→dashboard), `review` (rating→Kafka→restaurant score→ES ranking), `config` (delivery fee/VAT/discount values + feature-flag toggles). All build on the P3 event backbone. Independent tracks — parallelizable.

## Key insights
- Analytics is a pure read-side consumer: fold order/payment events into ClickHouse aggregates (top food, top restaurant, revenue, order counts). ClickHouse behind `analytics` profile OFF by default (RAM). Fallback to Postgres materialized views documented.
- Review closes the loop with search: rating events recompute restaurant average → emit to ES so P4 search can rank/filter by rating.
- Config holds the VALUES (fee, VAT, discount); feature flags only TOGGLE behavior. Don't conflate — flag = boolean switch, config = business number. Values are tenant-overridable.

## Requirements
**Functional**: analytics dashboards (top food/restaurant, revenue, orders over time); submit review → updates restaurant rating → reflected in search; config CRUD for fee/VAT/discount with tenant overrides; feature-flag evaluation SDK.
**Non-functional**: analytics queries sub-second on ClickHouse; review rating recompute idempotent; config reads cached + hot-reload on change; flag eval <1ms.

## Architecture
- `analytics`: Kafka consumer on `order.events`+`payment.events` → insert into ClickHouse (or Postgres) → aggregate query API for dashboard.
- `review`: REST submit (auth, one-review-per-order) → persist + emit `review.events` → consumer recomputes restaurant avg → emit to catalog read model + ES (rating field for ranking/filter).
- `config`: Postgres-backed key/value with tenant scoping + defaults; feature-flag store; SDK/interceptor in `shared` reads config+flags with cache + invalidation on change event.

## Related code files (to create)
- `apps/analytics/*` — event consumers, ClickHouse client, aggregate queries, dashboard API
- `apps/review/*` — review controller, persistence, review.events emit, rating-recompute consumer → ES/read-model update
- `apps/config/*` — config CRUD, feature-flag store, change-event emitter
- `libs/shared/config-client/*` — read config values + evaluate flags with cache
- `infra/*` — ClickHouse (`analytics` profile, off by default)
- Migrations: `reviews`, `config_entries`, `feature_flags`

## Implementation steps
1. `config`: schema + CRUD (fee/VAT/discount, tenant override) + feature-flag store; emit change events; `shared/config-client` with cache + invalidation.
2. Wire order (P2/P3) to read delivery fee/VAT/discount from config-client instead of hardcoded.
3. `review`: submit endpoint (one per delivered order), persist, emit review.events; recompute consumer updates restaurant avg → catalog read model + ES rating field.
4. Update P4 search ranking/filter to use the rating field.
5. `analytics`: add ClickHouse (`analytics` profile); consume order/payment events; build aggregates; dashboard API (top food/restaurant, revenue, orders).
6. E2E: change delivery fee in config → new orders use it; submit rating → restaurant score changes → search ranks by it; place/pay orders → analytics dashboard reflects revenue+top items.

## Todo
- [ ] config service (values + tenant override) + feature flags + change events
- [ ] shared/config-client with cache + invalidation; order uses it
- [ ] review submit + emit + rating recompute → read model + ES
- [ ] search ranking/filter uses rating
- [ ] analytics consumers → ClickHouse + dashboard API (`analytics` profile)
- [ ] E2E: config change, rating→search, revenue dashboard

## Success criteria
- Changing delivery fee/VAT in config immediately affects new order totals; feature flag toggles a behavior without redeploy.
- New rating updates restaurant average and changes search ranking/filter results.
- Analytics dashboard shows correct revenue, top foods, top restaurants, order trend from real events.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| ClickHouse RAM on 16GB | M×M | `analytics` profile off by default; Postgres MV fallback documented |
| Rating recompute race | M×M | Idempotent recompute from event; version/updated_at guard |
| Config cache staleness | M×M | Invalidate on change event; short TTL fallback |
| Flag/config conflation | L×M | Enforce: flag=boolean, config=value; separate stores/APIs |

## Security considerations
- Config writes admin-only, audit-logged, tenant-scoped. One review per delivered order per user (prevent spam/fraud).
- Analytics dashboards tenant-isolated; no cross-tenant aggregate leakage.
- Feature flags cannot escalate privilege (no auth-bypass flags).

## Next steps
Feeds P7 (analytics + orders motivate partitioning/scaling). Config becomes the source for tunables used across services.
