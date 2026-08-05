# Slice 6c — Analytics service (ClickHouse dashboards)

Context: [phase-06.md](./phase-06-analytics-review-config.md) · [phase-03c.md](./phase-03c-order-saga-events.md) · [phase-06b.md](./phase-06b-review-rating-search.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P2 — third/last P6 slice (after 6a config #21/#22, 6b review #23/#24). Completes P6.
- **Status**: ✅ Done (#25) — verified live + adversarially reviewed (loopback/tz/DLQ fixes applied) → merged. Branch `feat/analytics-service`. `analytics` service (ClickHouse `orders_fact` ReplacingMergeTree, no Postgres) consuming `order.events` + tenant-scoped dashboards. Live evidence: analytics-e2e **3/3** (dashboards reflect produced orders · redelivery no double-count · tenant isolation); independent checks — summary `{revenueCents, confirmedCount, cancelledCount}` correct, top-restaurants `[{restaurantId, revenueCents, orderCount}]` where attributed, a random other tenant → all zeros; the consumer replayed ALL ~416 historical `order.events` from the beginning + deduped via FINAL (51 CONFIRMED / 365 CANCELLED). Offline: analytics **26** unit + gateway **30**; tsc/biome/depcruise/knip. ClickHouse `25.8` + `@clickhouse/client@1.23.1`. **Fix during live verify**: the 25.8 image generates a localhost-only `default-user.xml` that rejected the service over the docker network → set `CLICKHOUSE_SKIP_USER_SETUP=1` in compose (permissive built-in default user; dev-only, profile off by default, real creds → P8).
- **Adversarial review + fixes applied** (report intended `../reports/code-reviewer-260730-2245-slice-6c-analytics-clickhouse-red-team-review-report.md`) — **NO Critical/High**: injection (all 5 ClickHouse call sites bind via `query_params`, INSERT is structured JSONEachRow), tenant isolation (every query `WHERE tenant_id = {verified}`, `TrustedIdentityInterceptor` fails closed 401), dedup/revenue accuracy (order FSM makes CONFIRMED/CANCELLED terminal → no state-transition collapse; all aggregates use `FINAL`), and ingestion-loss (INSERT failure → retry → DLQ, never silent) all source-verified SOLID. Fixes:
  - **M1 (Medium)** — `CLICKHOUSE_SKIP_USER_SETUP` (unauthenticated default user) + a `0.0.0.0` port bind exposed every tenant's facts to the dev LAN. **Fixed**: ClickHouse ports bound to `127.0.0.1` (host-run services/e2e still reach it; nothing off-box).
  - **L1** — revenue-series `toDate(occurred_at)` buckets by SERVER tz. **Fixed**: pin `<timezone>UTC</timezone>` so day buckets are deployment-independent (occurred_at is UTC).
  - **L2** — a valid-type lifecycle event failing field validation was warn-skipped (silent). **Fixed**: throw → the shared consumer retries then dead-letters it (observable), matching the repo's never-silently-drop ethos.
  - All re-verified: analytics-e2e **3/3** after the fixes; loopback bind + UTC confirmed live.
- **Completes P6.**
- **Brief**: A read-side `analytics` service consumes `order.events` into **ClickHouse** and exposes a tenant-scoped dashboard API: revenue over time, order counts (confirmed vs cancelled), and top restaurants by revenue/order-count. ClickHouse teaches columnar OLAP aggregation on the same event backbone; it lives behind an `analytics` compose profile that is **OFF by default** (RAM on a 16GB machine).

## Key decisions (verify versions live before building)
- **ClickHouse** single-node (`clickhouse/clickhouse-server`, latest stable LTS — verify the tag; ~24.8-LTS or newer) behind a NEW `analytics` compose profile, off by default, with a low-memory config (bounded `max_server_memory_usage`, no distributed setup). Node client **`@clickhouse/client@1.23.1`**. Documented fallback: Postgres materialized views if ClickHouse proves too heavy — but ClickHouse is the primary (the learning goal).
- **Pure read-side consumer**: analytics ONLY consumes `order.events` and NEVER writes back — an analytics store, never a source of truth (safe to rebuild by replaying the topic from the beginning).
- **Ingest fact = `OrderConfirmed`** (revenue-bearing, implies payment succeeded): each carries `{ orderId, userId, status, totalCents, restaurantId }` + the envelope's `tenantId` + `occurredAt`. `OrderCancelled` ingested too (a separate status) to report confirmed-vs-cancelled counts. One fact row per order.
- **Idempotent ingestion**: a `ReplacingMergeTree` fact table keyed by `(tenant_id, order_id)` so a redelivered `OrderConfirmed`/`OrderCancelled` collapses on merge (queries use `FINAL` or GROUP BY to be merge-independent) — ClickHouse isn't transactional, so dedupe is by table engine, not a ledger. Consumer reads from the beginning on a fresh group (replay-safe, like the config-client consumer).
- **Top FOOD (item-level) is DEFERRED** (documented): `order.events` carries no line items (RESERVE_STOCK's items go to the saga command topic, not the public lifecycle event). Top-food needs an `OrderConfirmed` enriched with items, or a dedicated order-items analytics event — a small follow-up, out of this slice. 6c delivers revenue / order-count / trend / **top-restaurant** (all available from `OrderConfirmed` + `restaurantId` added in 6b).
- **Dashboard API** (tenant-scoped, read-only): `GET /api/v1/analytics/revenue?from&to&granularity` (revenue + order count bucketed by day), `GET /api/v1/analytics/top-restaurants?from&to&limit` (by revenue and count), `GET /api/v1/analytics/summary` (totals: revenue, confirmed, cancelled). All filtered by the verified tenant.

## Requirements
**Functional**: consume `OrderConfirmed`/`OrderCancelled` → ClickHouse fact rows; dashboard endpoints return revenue-over-time, order counts, and top restaurants for the caller's tenant. **Non-functional**: sub-second aggregate queries on ClickHouse; ingestion idempotent (redelivery-safe via ReplacingMergeTree); tenant-isolated (no cross-tenant aggregate leakage); `analytics` profile only up when needed; rebuildable by replaying the topic.

## Architecture / data flow
```
order.events (OrderConfirmed|OrderCancelled) ─▶ analytics consumer (read from beginning, idempotent)
        └─ INSERT one fact row → ClickHouse orders_fact
             (tenant_id, order_id, restaurant_id, user_id, status, total_cents, occurred_at)
             ReplacingMergeTree((tenant_id, order_id)) → redelivery collapses on merge

client ─GET /api/v1/analytics/{revenue|top-restaurants|summary}─▶ analytics
        └─ ClickHouse aggregate (SUM/COUNT/GROUP BY, tenant-filtered, FINAL) → JSON
ClickHouse behind the `analytics` compose profile (off by default)
```

## Related code files (to create)
- `apps/analytics/` — new Nx HTTP app (scope:analytics, type:app), NO Postgres (ClickHouse only), PORT 3010, prefix api/v1, pino, shutdown. Mirror catalog's bootstrap minus TypeORM.
- `config/analytics-env-schema.ts` — CLICKHOUSE_URL/USER/PASSWORD/DATABASE, KAFKA_BROKERS/CLIENT_ID, PORT 3010.
- `domain/analytics/*` — fact model + aggregate query ports (revenue-series, top-restaurants, summary), value objects (date range, granularity).
- `application/*` — ingest-order-event handler; the three query handlers.
- `infrastructure/clickhouse/*` — ClickHouse client module (`@clickhouse/client`), schema bootstrap (create DB + `orders_fact` ReplacingMergeTree on boot if absent), the fact writer + aggregate query adapters (parameterised queries — NEVER string-interpolate the tenant/range).
- `interface/http/analytics.controller.ts` + DTOs (tenant from shared-tenancy verified identity) + `interface/messaging/order-events.consumer.ts` (idempotent-ish; ReplacingMergeTree handles dedupe).
- `infra/docker-compose.yml` — `clickhouse` service under a new `analytics` profile (low-mem config, a named volume, healthcheck). `.env.example` — analytics keys. `package.json` — analytics in `dev` (tagless run-many already covers it) + no migration (ClickHouse bootstrap is code, not TypeORM — no `migration-*` opt-in markers). `apps/gateway/*` — proxy `/api/v1/analytics/*` + breaker serviceName 'analytics' + ANALYTICS_SERVICE_URL.
- `apps/analytics-e2e/` — compose `core`+`messaging`+`analytics`: produce a few `OrderConfirmed`/`OrderCancelled` on `order.events` → assert revenue/summary/top-restaurants reflect them; a redelivered event doesn't double-count; tenant isolation (another tenant's orders don't leak).

## Implementation steps
1. Add the `analytics` ClickHouse compose profile (low-mem) + verify the server + `@clickhouse/client` versions live.
2. Scaffold `apps/analytics` (HTTP, no Postgres) + ClickHouse client module + schema bootstrap (`orders_fact` ReplacingMergeTree).
3. `order.events` consumer → ingest OrderConfirmed/OrderCancelled fact rows (read from beginning; ReplacingMergeTree dedupe).
4. Aggregate query adapters (revenue-series, top-restaurants, summary) — parameterised, tenant-filtered, `FINAL`.
5. Dashboard controller + DTOs (tenant-scoped) + gateway proxy + breaker.
6. `.env.example`, compose, dev wiring.
7. **E2E**: produce orders → dashboards reflect them; redelivery no double-count; tenant isolation.
8. Update plan before push; PR.

## Todo
- [x] `analytics` ClickHouse compose profile (off by default, low-mem) + versions verified (`clickhouse/clickhouse-server:25.8` confirmed live via `docker manifest inspect`; `@clickhouse/client@1.23.1` confirmed current on npm)
- [x] `apps/analytics` scaffold (HTTP, no Postgres) + ClickHouse client + `orders_fact` bootstrap
- [x] `order.events` consumer → ingest OrderConfirmed/OrderCancelled (ReplacingMergeTree dedupe, read-from-beginning)
- [x] aggregate adapters: revenue-series, top-restaurants, summary (parameterised, tenant-filtered, FINAL)
- [x] dashboard controller + DTOs + gateway proxy `/api/v1/analytics/*` (+ breaker) + ANALYTICS_SERVICE_URL
- [x] compose + .env.example + dev wiring
- [x] E2E: dashboards reflect produced orders; redelivery no double-count; tenant isolation (spec written, gated behind `RUN_ANALYTICS_E2E`, not yet run against a live stack)
- [x] biome/cruiser/knip/tsc + unit tests; plan updated before push

## Success criteria
- Producing confirmed/cancelled orders makes revenue, order counts, and top-restaurant dashboards reflect them within seconds; queries are sub-second.
- A redelivered order event does not double-count (ReplacingMergeTree).
- Dashboards are tenant-isolated (one tenant never sees another's aggregates).
- The `analytics` profile is off by default and the service rebuilds by replaying the topic.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| ClickHouse RAM on 16GB | M×M | `analytics` profile OFF by default; single-node low-mem config; Postgres-MV fallback documented |
| Double-count on redelivery | M×M | ReplacingMergeTree((tenant_id, order_id)) + FINAL/GROUP BY queries; read-from-beginning replay-safe |
| Cross-tenant aggregate leak | L×H | Every query WHERE tenant_id = verified tenant; parameterised, never interpolated |
| ClickHouse eventual-merge staleness | M×L | Use FINAL or GROUP BY so results are correct pre-merge; documented |
| No item-level data for top-food | — | Deferred + documented; not a defect of this slice |

## Security considerations
- Dashboards tenant-scoped from the verified identity; every ClickHouse query is parameterised + `WHERE tenant_id = ?` — no cross-tenant leakage, no query injection from date/limit params (validated + bound).
- ClickHouse internal-network only; dev creds via env, real creds via secret provider (P8). Not exposed via Nginx.
- Read-only surface (no writes from the API); analytics never mutates business state.

## Next steps
Completes P6. Top-food + per-item analytics when order events carry line items (a small order-event enrichment). P7 (data scaling) can partition the fact table / add a distributed ClickHouse; P8 wires dashboards into observability.
