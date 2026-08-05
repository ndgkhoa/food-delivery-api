# Demo data seeder

Seeds (and tears down) a realistic slice of demo data by driving the REAL REST
API through the gateway, so data propagates through the real event flows
(catalog → read-model/search, orders → saga → inventory/payment/notification
/analytics/review-eligibility, order confirmation → delivery driver
assignment). Three deliberate carve-outs, where no HTTP endpoint exists for
what the seeder needs to write: inventory stock (own Postgres DB), delivery
driver GEO positions (Redis GEO), and media object teardown (MinIO).

## Prerequisites

1. The full dev stack is running and the Keycloak realm is imported:
   ```bash
   pnpm install
   cp .env.example .env   # if you haven't already
   docker compose --env-file .env -f infra/docker-compose.yml --profile core --profile auth up -d
   pnpm db:migrate
   pnpm dev
   ```
2. The gateway (`:3000`), auth, catalog, order, config, and inventory services
   are all reachable, and the `food-delivery` Keycloak realm (with its
   `admin-user` / `admin-pass` bootstrap admin) is imported — this is the
   default `infra/keycloak/realm-export.json` the compose `auth` profile
   loads on first boot.
3. Postgres has the `inventory` database (auto-created by
   `infra/postgres/init` on first Postgres boot) reachable with the
   `DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD` in your `.env`.
4. Redis (`REDIS_URL`) and MinIO (`MINIO_ENDPOINT`/`MINIO_PORT`/
   `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`/`MINIO_USE_SSL`/`MEDIA_BUCKET`) are
   reachable — both default to the `core` profile's containers.
5. The `delivery`, `media`, and `review` services (in addition to gateway/
   auth/catalog/order/config/inventory) are running, and Kafka consumers for
   `order.events` are up on delivery + review, so driver assignment and
   review-eligibility recording actually happen.

## Run it

```bash
pnpm seed:up     # create demo tenants, users, restaurants, menu items, config, stock, orders
pnpm seed:down   # tear down everything seed:up created
```

Config is read from `process.env` (loaded from `.env` via `dotenv/config` if
present), with defaults matching `.env.example`. Override anything via env
vars, e.g.:

```bash
GATEWAY_URL=http://localhost:3000/api/v1 \
KEYCLOAK_URL=http://localhost:8080 \
KEYCLOAK_REALM=food-delivery \
KEYCLOAK_SPA_CLIENT_ID=food-delivery-spa \
SEED_BOOTSTRAP_ADMIN_USERNAME=admin-user \
SEED_BOOTSTRAP_ADMIN_PASSWORD=admin-pass \
DB_HOST=localhost DB_PORT=5432 DB_USERNAME=postgres DB_PASSWORD=abc123456 \
INVENTORY_DB_NAME=inventory \
MEDIA_DB_NAME=media \
ORDER_DB_NAME=order \
REDIS_URL=redis://localhost:6379 \
MINIO_ENDPOINT=localhost MINIO_PORT=9000 \
MINIO_ACCESS_KEY=minioadmin MINIO_SECRET_KEY=minioadmin MINIO_USE_SSL=false \
MEDIA_BUCKET=media \
PAYMENT_STUB_FAIL_AT_CENTS=66600 \
pnpm seed:up
```

`ORDER_DB_NAME` (default `order`) and `PAYMENT_STUB_FAIL_AT_CENTS` (default
`66600`) back the edge-case scenarios below — see
[Edge-case demo scenarios](#edge-case-demo-scenarios). If your `.env`
overrides `PAYMENT_STUB_FAIL_AT_CENTS` for the payment service, override it
here too so the saga-compensation scenario's price still matches.

## What `seed:up` creates

For each of 2 demo tenants (`demo-acme-foods`, `demo-best-bites`):

- 1 tenant (via `POST /api/v1/auth/tenants`, as the bootstrap admin)
- 4 provisioned Keycloak users (`admin`, `restaurant-owner`, `customer`,
  `driver` roles) via `POST /api/v1/auth/tenants/:id/users`
- 3 restaurants × 4 menu items each (as the tenant's `restaurant-owner`) via
  `POST /api/v1/catalog/restaurants` + `POST /api/v1/catalog/restaurants/:id/menu-items`
- 3 config overrides (`order.delivery_fee_cents`, `order.vat_rate_bps`,
  `order.discount_cents`) via `PUT /api/v1/config/:key`, as the tenant's
  `admin` user
- 1 inventory stock row per menu item, written directly into the
  `inventory` Postgres database (`stock` table)
- 1 online driver GEO position, written directly into Redis (`GEOADD`) as
  the tenant's `driver` user, BEFORE any order is placed — see
  [Delivery driver GEO carve-out](#delivery-driver-geo-carve-out)
- 1 media object per tenant, uploaded through the REAL presigned-upload flow
  as the tenant's `restaurant-owner` — see [Media upload](#media-upload)
- (first tenant only) 2 demo orders placed by the tenant's `customer` via
  `POST /api/v1/orders` with a fresh `Idempotency-Key` per request, followed
  by 2 reviews submitted for those same orders once each confirms — see
  [Review submission](#review-submission)

After every tenant is seeded, 4 edge-case demo scenarios run against the
FIRST tenant only, driving a dedicated "Demo Edge Cases" restaurant + 3 menu
items — see [Edge-case demo scenarios](#edge-case-demo-scenarios) for what
each one demonstrates and how to observe it in Bruno.

All created ids are written to `tools/seed/.seed-state.json` (git-ignored) as
the run progresses, so a mid-run failure never loses already-created ids —
inspect the file and run `pnpm seed:down` to clean up, or re-run `seed:up`
(tenant/user creation tolerates a 409 "already exists" and reuses the
existing record).

## What `seed:down` does

Reads `tools/seed/.seed-state.json` and reverses, in order: cancel orders →
delete menu items + restaurants (this also removes the edge-case scenarios'
dedicated restaurant/items) → reset config values → delete stock rows
(including the scenarios' stock) → remove driver GEO locations → delete media
objects (MinIO) → delete Keycloak users → delete backdated partition-demo
order rows (direct DB) → drop the order partitions the partitioning scenario
created → remove the state file. Every step is best-effort and scoped to
exactly what `seed:up` created (never a table-wide delete/truncate); a
failure on one item is logged as a warning and teardown continues with the
rest. If `.seed-state.json` doesn't exist, `seed:down` prints a message and
exits 0. Submitted reviews are NOT deleted (see
[Review submission](#review-submission)) — `seed:down` only logs how many
were left behind.

## Edge-case demo scenarios

Run after the main tenant loop, against the FIRST seeded tenant
(`demo-acme-foods`), reusing its already-provisioned `restaurant-owner` /
`customer` logins. Each scenario is independently best-effort — a failure
logs a warning (`  ! scenario "..." failed: ...`) and the rest still run;
none of them can fail `seed:up` itself. All 4 place/insert orders that get
torn down the normal way (see [What `seed:down` does](#what-seeddown-does)).

First, a dedicated **"Demo Edge Cases"** restaurant is created (as the
tenant's `restaurant-owner`) with 3 menu items, each priced/stocked for one
scenario below. If this restaurant fails to create, ALL 4 scenarios are
skipped (logged) since every one of them depends on it.

### 1. Saga compensation

The **"Saga Compensation Special"** item is priced so a single-item order's
total lands EXACTLY on `PAYMENT_STUB_FAIL_AT_CENTS` (default 66600 — see
`apps/payment/src/application/charge/charge-decision.ts`), the stub's
deterministic decline trigger. The seeder places that order, then polls
`GET /orders/:id` until it reaches a terminal status and asserts it's
CANCELLED.

**Observe in Bruno:** copy the logged order id into `bruno/order/order-get.bru`
and `GET` it — `status` is `CANCELLED`, proving the full compensation path:
`POST /orders` → STARTED → stock reserved (RESERVED) → payment stub declines
→ COMPENSATING → stock released → CANCELLED
(`apps/order/src/application/saga/handle-payment-reply.handler.ts`).

### 2. Idempotency

The seeder `POST /orders`s the **"Idempotency Demo Bowl"** item TWICE with
the exact same `Idempotency-Key` header and body, and asserts both responses
return the SAME order id (logged as `PASS`/`FAIL`).

**Observe in Bruno:** in `bruno/order/order-place.bru`, send the SAME request
twice with the SAME `Idempotency-Key` value (don't regenerate `{{$guid}}` —
reuse whatever you sent the first time) and confirm the returned `id` is
identical both times, per
`apps/order/src/application/order/commands/place-order.handler.ts`.

### 3. No-oversell concurrency

The **"Low Stock Flash Item"** is seeded with only 3 units. The seeder fires
8 CONCURRENT `POST /orders` (1 unit each, distinct idempotency keys) via
`Promise.allSettled`, polls every placed order to a terminal status, and logs
the tally — e.g. `3 CONFIRMED / 5 CANCELLED-or-other (of 8 placed, seeded
stock=3)`. Asserted PASS when CONFIRMED count exactly equals seeded stock —
this can never be exceeded because of the atomic conditional decrement in
`apps/inventory/src/application/reservation/commands/reserve-stock.handler.ts`
(`UPDATE ... WHERE available >= qty`).

**Observe in Bruno:** the console tally IS the observation (a race condition
isn't reproducible one request at a time in Bruno); optionally `GET` a few of
the logged order ids to see the mix of CONFIRMED/CANCELLED outcomes.

### 4. Order partitioning

A direct-DB carve-out (`order-db.ts`, no HTTP surface for backdating
`created_at`) inserts a few minimal valid `orders`/`order_items` rows into
the PREVIOUS 2 calendar months, creating each month's partition first if
missing — replicating the exact
`CREATE TABLE ... PARTITION OF "orders" FOR VALUES FROM (...) TO (...)` SQL
from
`apps/order/src/infrastructure/persistence/partitioning/orders-partition-maintenance.ts`.
Combined with current-month rows (from the main seed + the other 3
scenarios), `orders` ends up spanning 3+ monthly partitions
(`orders_pYYYYMM`).

**Observe via `psql`** (not Bruno — this is a storage-layer demonstration):

```sql
-- List the partitions:
SELECT inhrelid::regclass AS partition
FROM pg_inherits
WHERE inhparent = 'orders'::regclass;

-- Confirm pruning: only the relevant month's partition should appear
-- under "Scan" in EXPLAIN's output for a date-bounded query.
EXPLAIN SELECT * FROM orders
WHERE tenant_id = '<tenant-id-from-.seed-state.json>'
  AND created_at >= date_trunc('month', now() - interval '1 month')
  AND created_at <  date_trunc('month', now());
```

**Read-replica note:** `OrdersController.findAll` (`GET /orders`) may be
served from a streaming read replica when one is configured
(`DB_REPLICA_HOST`/`DB_REPLICA_PORT` on the order service) — that's a STACK
concern, not something this seeder provisions. Enable it via the compose
`replica` profile if you want to demo replica-served reads; it's orthogonal
to the partitioning demo above, which reads directly against the primary.

## Assumptions & contract gaps (read before relying on this)

- **Bootstrap admin identity.** `POST /auth/tenants` requires the platform
  `admin` role. The only such identity seeded by
  `infra/keycloak/realm-export.json` is `admin-user` / `admin-pass` (tenant
  `11111111-1111-4111-8111-111111111111`). The seeder logs in as this user via
  a direct Keycloak password grant (mirroring `bruno/auth/login-admin.bru`)
  to create tenants — it never mutates or depends on that user's own tenant.
- **Per-tenant `admin` user (not just owner/customer/driver).** A config
  write (`PUT /config/:key`) without `global: true` always targets the
  CALLER'S OWN tenant (`UpsertConfigValueHandler`); a `global` write requires
  the `platform-admin` role, which no seeded or provisionable user holds
  (`PROVISIONABLE_ROLES` is `admin | restaurant-owner | customer | driver`).
  So the only way to set a config override for a *newly created* tenant is to
  provision an `admin` user that belongs to that exact tenant — the seeder
  does this in addition to owner/customer/driver.
- **No `DELETE /config/:key` endpoint.** The config service only exposes
  `GET`/`PUT`. `seed:down` cannot delete the override rows it wrote; instead
  it `PUT`s each key back to the order service's hardcoded fallback
  (`order.delivery_fee_cents=1500`, `order.vat_rate_bps=1000`,
  `order.discount_cents=0`, from `place-order.handler.ts`), so a torn-down
  tenant behaves identically to one that was never configured. The override
  ROW still exists afterwards (value reset, not removed).
- **No `DELETE /tenants/:id` endpoint.** Tenants created by `seed:up` are
  never deleted by `seed:down` — only their provisioned users, catalog data,
  config values, and stock rows are. Re-running `seed:up` reuses the existing
  tenant (409 → looked up by slug).
- **Order cancellation is best-effort.** By the time `seed:down` runs, the
  order saga may already have moved a demo order to `CONFIRMED`, which can no
  longer be cancelled (illegal state transition). This is logged as a warning
  and teardown continues — orders are otherwise inert demo data.
- **Inventory stock carve-out.** `apps/inventory` exposes no HTTP surface for
  stock (only gRPC, used internally by the order saga). The seeder connects
  directly to the inventory service's own Postgres database
  (`INVENTORY_DB_NAME`, default `inventory`) and upserts/deletes rows in its
  `stock` table (`tenant_id`, `item_id`, `available` — see
  `apps/inventory/src/infrastructure/persistence/entities/stock.orm-entity.ts`),
  scoped to exactly the `(tenant_id, item_id)` pairs it created.

- **Delivery driver GEO carve-out.** `apps/delivery` exposes no HTTP surface
  for reporting a driver's position on their behalf — a real driver reports
  it over the delivery WebSocket gateway
  (`apps/delivery/src/interface/ws/delivery.gateway.ts`), authenticated by a
  JWT whose `sub` claim becomes the `driverId`. The seeder mirrors that
  exactly: it connects directly to Redis (`REDIS_URL`, the shared `core`
  instance) and `GEOADD`s the tenant's `driver` user (member =
  `keycloakUserId`, i.e. the same value a real WS handshake's `sub` would
  be) into the tenant-prefixed GEO key `geo:<tenantId>:drivers` — the exact
  key format `RedisDriverLocationStore` reads
  (`apps/delivery/src/infrastructure/redis/redis-driver-location.store.ts`).
  This runs BEFORE any order is placed so `AssignDriverHandler`'s online
  roster already has a candidate the moment `OrderConfirmed` fires
  (`apps/delivery/src/application/assign-driver.handler.ts`); today that
  handler picks "first available" from the roster (no distance sort yet), so
  the coordinates chosen are plausible-but-arbitrary points near a fixed
  demo-city origin (`DEMO_CITY_ORIGIN` in `demo-data-fixtures.ts`), not tied
  to any real restaurant geo (none exists yet). Teardown `ZREM`s the same
  member — a real HTTP surface for this doesn't exist to reverse it any
  other way.

- **Media upload — real presigned flow, not a mock.** The seeder drives
  `apps/media`'s actual upload contract
  (`apps/media/src/interface/http/media.controller.ts` +
  `apps/media/src/application/create-upload.handler.ts`): `POST
  /media/uploads` (declares `contentType`/`sizeBytes`, gets back a presigned
  PUT URL), then a raw `PUT` of a tiny embedded valid PNG (68 bytes,
  `demo-image-fixture.ts`) straight to that URL — this goes DIRECTLY to
  MinIO, never through the gateway, exactly like a real client — then `POST
  /media/uploads/:id/complete`. **No `DELETE /media/:id` route exists**, so
  `seed:down` instead removes the object bytes directly from MinIO
  (`minio-media-store.ts`, same client-construction pattern as
  `apps/media/src/infrastructure/minio/minio-client.module.ts`) AND deletes the
  `media_objects` metadata row directly in the media Postgres DB
  (`media-db.ts`, a teardown carve-out mirroring the inventory-stock one). So a
  seeded media object is fully removed — both the bytes and the row.

- **Review submission — polls confirmation, retries eligibility.** Review
  eligibility is recorded by a SEPARATE async Kafka consumer
  (`RecordReviewEligibilityHandler`, driven off `OrderConfirmed` via
  `apps/review/src/interface/messaging/order-events.consumer.ts`), so the
  seeder: (1) polls `GET /orders/:id` (bounded — 20 attempts × 1.5s) until
  `status` is `CONFIRMED`; (2) `POST`s `/reviews` as the order's own
  customer with a rating + comment; (3) if that 404s with
  `REVIEW_ELIGIBILITY_NOT_FOUND` (`apps/review/src/domain/shared/errors.ts`)
  — the eligibility consumer hasn't caught up yet — retries up to 5 times
  with a 2s delay. An order that never confirms in time, or a review that
  still fails after retries, is logged as a warning and skipped; it never
  aborts the rest of the seed run. **No `DELETE /reviews/:id` route exists**,
  so `seed:down` cannot remove submitted reviews — it only logs how many were
  left in place. Reviews only run for the first tenant, same as demo orders
  (the eligibility-consumer round trip is exactly the kind of async traffic
  the "orders only on tenant 0" convention already exists to avoid
  doubling).

- **Order-partitioning carve-out + its schema limitation.** Backdating a
  `created_at` has no HTTP surface (`POST /orders` always stamps "now"), so
  the partitioning scenario (`seed-up-scenario-partitioning.ts`) connects
  directly to the order service's own Postgres database (`ORDER_DB_NAME`,
  default `order`) and inserts `orders`/`order_items` rows explicitly,
  mirroring `OrderOrmEntity`/`OrderItemOrmEntity` column-for-column
  (`order-db.ts`). This is safe because `order_items.order_id` has NO
  foreign key back to `orders` — the partition migration
  (`apps/order/src/infrastructure/persistence/migrations/1753748200000-partition-orders-by-month.ts`)
  deliberately drops it (a partitioned table's PK can only be FK-referenced
  together with its partition key). The one deliberate simplification: the
  backdated rows use a small FIXED demo total (30/12/2.40/0 dollars
  subtotal/delivery/VAT/discount, all in cents) rather than resolving real
  catalog prices — authentic enough to prove partition pruning, but NOT
  wired through `Order.create`'s pricing calculation like a real order.
  `seed:down` deletes exactly these rows by id (`order_items` first, then
  `orders`) and drops only the partitions this run itself created (checked
  via `to_regclass` before creating — a partition that already existed,
  e.g. from a prior run or the app's own boot-time maintenance service, is
  reused but never tracked for teardown).
