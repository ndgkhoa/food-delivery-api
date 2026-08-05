# Order Service (Slice 2b) — Implementation Report

Plan: `plans/260725-2139-food-delivery-microservices/phase-02-order-core-inventory.md` (Slice 2b)

## What was built

### apps/order (new HTTP service, PORT 3003)
- **Domain** (`domain/`): `Order` aggregate with an explicit allowed-transitions table (PENDING→RESERVED, PENDING→CANCELLED, RESERVED→CONFIRMED, RESERVED→CANCELLED; illegal transitions throw `IllegalOrderTransitionError`); `OrderItem` value object (qty/unitPriceCents/lineTotalCents, all validated positive/non-negative integers); ports `OrderRepository`, `IdempotencyRepository`, `CatalogGatewayPort`, `InventoryGatewayPort`, `TransactionPort`; domain errors (`OrderNotFoundError`, `IllegalOrderTransitionError`, `MenuValidationError`, `InsufficientStockError`, `IdempotencyConflictError`, `OrderConcurrencyConflictError`, `OrderForbiddenError`, `InvalidOrderRequestError`).
- **Application** (`application/`): `PlaceOrderHandler` (idempotency check → catalog validate → claim idempotency key → inventory reserve → persist RESERVED, or persist CANCELLED + throw on `ok:false`; compensating `release` on a post-reserve persist failure), `CancelOrderHandler`, `ConfirmOrderHandler`, `GetOrderHandler` (ownership: owner or `admin` role, via shared `assertOrderOwnership`). Idempotency-claim logic extracted to `claim-idempotency-key.ts` to keep the handler under ~180 lines.
- **Infrastructure** (`infrastructure/`): `OrderOrmEntity` (`@VersionColumn`), `OrderItemOrmEntity`, `IdempotencyKeyOrmEntity` (composite PK `tenant_id, user_id, key`); `TypeOrmOrderRepository` (insert-or-optimistic-conditional-update via `WHERE version = :version`, throws `OrderConcurrencyConflictError` on 0 affected rows); `TypeOrmIdempotencyRepository` (raw `.insert()` so a duplicate raises real `23505`); own ALS-based `TransactionPort`/`data-source.ts`/`typeorm-options.ts`/`persistence.module.ts` (mirrors inventory's pattern); migration `1753747400000-create-order-tables.ts` (orders/order_items/idempotency_keys). `infrastructure/grpc/`: `GrpcClientsModule` (ClientsModule.registerAsync for catalog+inventory), `CatalogGrpcAdapter`, `InventoryGrpcAdapter` (tenant stamped via `x-tenant-id` metadata; ABORTED retried up to 3x via `retryOnAborted`; ALREADY_EXISTS/ABORTED mapped to `IdempotencyConflictError`/`OrderConcurrencyConflictError`).
- **Interface** (`interface/http/`): `OrdersController` (`POST /orders`, `POST /orders/:id/cancel`, `POST /orders/:id/confirm`, `GET /orders/:id`; `Idempotency-Key` header required on place); `OrderDomainErrorFilter` (single filter mapping all 8 domain errors → 404/409/422/403/400); DTOs with class-validator (value imports throughout, per `useImportType: off`).
- `config/order-env-schema.ts` (DB_NAME=order, PORT=3003, CATALOG_GRPC_URL, INVENTORY_GRPC_URL), `app.module.ts`, `main.ts` (HTTP-only, no gRPC server).
- Full Nx scaffolding: `project.json`, `tsconfig*.json`, `webpack.config.js`, `jest.config.cts`.

### Gateway wiring
- `OrderProxyController` (`@Controller('orders')`, forwards `/api/v1/orders/*` to `ORDER_SERVICE_URL`), registered in `app.module.ts` before `AuthProxyController`'s catch-all (mirrors catalog).
- `ORDER_SERVICE_URL` added to `gateway-env-schema.ts` (default `http://localhost:3003`).

### Config/wiring
- `@order/*` alias added to `tsconfig.base.json` + `knip.json` (paths + entry for `data-source.ts`).
- `migration:order:{generate,run,revert}` scripts added to `package.json`.
- `.env.example` documents the `order` DB creation + `ORDER_SERVICE_URL`.
- `commitlint.config.mjs` already had `order` in scope-enum — no change needed.
- `infra/docker-compose.yml` — **no change**: the compose file only defines the shared core Postgres/Redis/Nginx (no per-service compose entries exist for catalog/inventory either); order reuses the same core Postgres under its own `order` database exactly like inventory, documented in `.env.example`.

### Tests
- Unit (34 passing, `pnpm nx test order`): `order.spec.ts` (state machine, all legal/illegal transitions), `order-item.spec.ts` (qty/price validation), `place-order.handler.spec.ts` (happy path + total-from-catalog, missing/unavailable menu item, reserve ok:false → CANCELLED + `InsufficientStockError`, idempotent replay with no re-call of catalog/inventory, compensating release on post-reserve persist failure), `order-lifecycle-handlers.spec.ts` (cancel/confirm/get: ownership, admin bypass, `OrderNotFoundError`, optimistic-conflict propagation, cancel still returns CANCELLED when the inventory release fails).
- `apps/order-e2e` (testcontainers — **not run**, per instructions): real Postgres for order AND inventory, real Redis, a lightweight but real in-process catalog gRPC server (`fake-catalog-grpc-server.ts`, genuine `@grpc/grpc-js` server against an in-memory tenant-scoped item map), and a real in-process inventory gRPC microservice (`@inventory/app.module`, actual reserve/release + Redis lock + Postgres), wired via `boot-order-stack.ts` (mirrors inventory-e2e's "set env → dynamic import → bootstrap" pattern, done in two phases since inventory and order need different DB_* values). Three spec files: `order-place-cancel.e2e-spec.ts` (place→RESERVED+stock decrement, cancel→CANCELLED+stock release, unavailable-item rejection), `order-idempotency.e2e-spec.ts` (sequential duplicate key → same order id, stock decremented once), `order-no-oversell-concurrency.e2e-spec.ts` (100 concurrent orders / stock=10 → exactly 10 RESERVED + 90 409 InsufficientStock + available=0).

## Verification run
- `pnpm biome check apps/order/src apps/order-e2e/src apps/gateway/src` — clean.
- `npx depcruise apps libs --config .dependency-cruiser.js` — 0 violations (323 modules).
- `pnpm knip --no-config-hints` — clean.
- `npx tsc -p apps/order/tsconfig.app.json --noEmit` / `tsconfig.spec.json` / order-e2e / gateway — clean.
- `pnpm nx test order` — 34/34 passing. `pnpm nx test gateway` — 17/17 passing (unaffected).
- e2e (testcontainers) intentionally **not run**, per instructions.

## Key decisions
1. **ORM entities have no relation between `OrderOrmEntity`/`OrderItemOrmEntity`** (plain `order_id` column only). An initial `@OneToMany`/`@ManyToOne` design created a real import cycle flagged by dependency-cruiser's `no-circular` rule; `TypeOrmOrderRepository` now loads/saves both sides explicitly (mirrors how inventory keeps `stock`/`reservations` unrelated at the ORM level).
2. **Order aggregate starts `PENDING` in-memory only** — `PlaceOrderHandler` builds it via `Order.create()` then immediately transitions (`.reserve()`/`.cancel()`) before the first persist, so the state machine's PENDING→RESERVED/CANCELLED transitions are genuinely exercised even though PENDING is never itself written to `orders`.
3. **Optimistic lock implemented as a manual conditional `UPDATE ... WHERE version = :version`** (via query builder), not TypeORM's automatic optimistic-lock machinery (which only engages via an explicit `lock: {mode:'optimistic'}` read) — consistent with the codebase's existing atomic-conditional-update convention (stock decrement, reservation release-gate).
4. **Idempotency key is a composite primary key** `(tenant_id, user_id, key)` rather than a separate unique index — the PK itself gives the 23505 on conflict, and `TypeOrmIdempotencyRepository.save` uses `.insert()` (not `.save()`) so a duplicate always raises a real Postgres error rather than silently upserting.
5. **`CancelOrderHandler` does not roll back / fail the request if the compensating inventory `release` fails** — it logs and still returns the CANCELLED order. Rationale: once the order row flips to CANCELLED, there is no legal transition back to RESERVED, so a client retry of `cancel` would hit `IllegalOrderTransitionError` — surfacing a 500 for a downstream release fault would strand the client on a terminal order it can't retry. Documented in code as the known synchronous-coupling gap the plan itself flags as motivation for the P3 Saga.
6. **gRPC client metadata typing**: the shared `CatalogGrpcClient`/`InventoryGrpcClient` contracts in `shared-contracts` don't declare the `metadata` parameter Nest's gRPC client proxy actually accepts. Rather than widen the shared lib type, each adapter declares a local, honestly-typed `...WithMetadata` interface for its own call site.
7. **`retryOnAborted`** gives inventory gRPC calls up to 3 attempts on ABORTED (lock contention) with a short linear backoff before surfacing `OrderConcurrencyConflictError` — safe because both reserve and release are idempotent/conditional at the DB layer.

## Deviations from the spec
- `infra/docker-compose.yml` was **not modified** — there was nothing service-specific to add (no other service, including inventory, has its own compose entry; all share one core Postgres/Redis via different `DB_NAME`s). Documented instead in `.env.example`.
- No `RolesGuard`/`@Roles` wiring in order's `app.module.ts` — the spec explicitly says "no special role needed beyond authenticated"; ownership (owner-or-admin) is enforced in the application handlers via `assertOrderOwnership`, so a global `RolesGuard` would be a no-op provider (YAGNI).
- No OpenAPI/Scalar setup for order (catalog has one) — not requested in the spec for this slice.

## Unresolved questions
1. **Truly-concurrent identical idempotency-key retries** (two requests racing the SAME key at the exact same instant, not a sequential retry) can surface `IdempotencyConflictError` (409, "still being created — retry shortly") instead of the winner's order, if the loser's `findById` runs before the winner's persist commits. The e2e idempotency test uses a sequential retry (matching the plan's literal scenario: "duplicate Idempotency-Key"); the fully-concurrent race is a known, documented gap consistent with this slice's "still synchronous" design note — should P3's Saga/outbox resolve this, or is a client-side retry-on-409 acceptable for now?
2. Confirm the intended HTTP status codes: 201 (default POST) for place/cancel/confirm — no explicit `@HttpCode` was set on cancel/confirm, so they return 201 rather than 200. Flag if 200 is preferred for those two.

**Status:** DONE
**Summary:** apps/order (hexagonal, HTTP-only, PORT 3003) implemented per Slice 2b spec — full domain/application/infra/interface layers, gateway proxy wiring, migrations, unit tests (34 passing), and order-e2e testcontainer suite (written, not run per instructions). Biome/depcruise/knip/tsc all clean.
**Concerns:** two unresolved questions above (concurrent-idempotency race semantics; cancel/confirm HTTP status code) — neither blocks correctness of the required behavior, both are judgment calls flagged for confirmation.
