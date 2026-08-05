# Codebase Summary & Module Map

A module-by-module reference guide for navigating the food-delivery-api monorepo. Use this to locate files, understand module responsibilities, and trace cross-module dependencies.

## Directory Structure Overview

```
food-delivery-api/
├── apps/                 13 NestJS services (+ *-e2e test suites)
├── libs/shared/          13 shared libraries (config, observability, persistence, etc.)
├── infra/                Docker Compose, Kubernetes, and tooling
├── tools/                Utilities (seed tool, scripts)
├── bruno/                Bruno HTTP API collection (one folder per service)
├── .github/workflows/    CI/CD pipelines (ci.yml, cd.yml, release-please)
├── docs/                 Project documentation (this folder)
├── package.json          pnpm workspace root
├── nx.json               Nx monorepo configuration
├── .env.example          Environment template
└── README.md             Project overview (not to be modified)
```

## Apps Directory (13 Microservices)

### `apps/gateway`
- **Port:** :3000
- **Purpose:** Single public entrypoint; JWT verification; RBAC; rate-limiting; reverse-proxy
- **Key Files:**
  - `src/interface/http/gateway.controller.ts` — Route handlers
  - `src/infrastructure/auth/jwt.guard.ts` — JWT verification guard
  - `src/infrastructure/rate-limit/rate-limiter.middleware.ts` — Rate limit (100/60s)
  - `src/infrastructure/circuit-breaker/` — opossum circuit breaker per service
- **No Database:** Purely routing layer
- **Depends On:** All 13 services (reverse-proxy)

### `apps/auth`
- **Port:** :3002
- **Purpose:** Keycloak-backed tenant & user management
- **Key Files:**
  - `src/application/commands/create-tenant.handler.ts` — Tenant CRUD via Keycloak Admin API
  - `src/infrastructure/keycloak-admin/` — Keycloak Admin API client
  - `src/domain/tenant/tenant.aggregate.ts` — Tenant aggregate root
- **Database:** None (Keycloak external)
- **Endpoints:** `/auth/tenants/*`

### `apps/catalog`
- **Port:** :3001
- **gRPC Port:** :50051
- **Purpose:** Restaurant & menu management; outbox for CDC to search
- **Key Files:**
  - `src/domain/restaurant/restaurant.aggregate.ts` — Restaurant entity
  - `src/domain/menu-item/menu-item.aggregate.ts` — MenuItem entity
  - `src/infrastructure/outbox/typeorm-outbox.adapter.ts` — Outbox pattern implementation
  - `src/infrastructure/persistence/entities/outbox.orm-entity.ts` — Outbox table schema
  - `src/interface/grpc/menu.service.ts` — gRPC ValidateMenuItems handler
- **Database:** `catalog` (restaurants, menu_items, restaurant_photos, outbox)
- **Topics Published:** `catalog.events` (via Debezium CDC)
- **Endpoints:** `/api/v1/restaurants/*`, gRPC `:50051`

### `apps/order`
- **Port:** :3003
- **Purpose:** Order saga orchestrator; state machine (PENDING → RESERVED → CONFIRMED)
- **Key Files:**
  - `src/domain/order/order.aggregate.ts` — Order entity with state machine
  - `src/domain/saga/order-saga.orchestrator.ts` — Saga coordination logic
  - `src/domain/idempotency/idempotency.entity.ts` — Idempotency key tracking
  - `src/infrastructure/saga-reaper/saga-reaper.job.ts` — Background job to re-drive stalled sagas
  - `src/infrastructure/persistence/entities/order.orm-entity.ts` — Monthly partitioned orders table
  - `src/application/commands/place-order.handler.ts` — PlaceOrder command handler
- **Database:** `order` (orders [partitioned], order_items, saga_log, processed_events)
- **Topics Consumed:** `payment.replies`, `inventory.replies`
- **Topics Published:** `order.events`
- **gRPC Calls:** inventory.Reserve(), catalog.ValidateMenuItems()
- **Endpoints:** `/api/v1/orders/*`

### `apps/inventory`
- **Port:** :50052 (gRPC only, no REST)
- **Purpose:** Stock reserve/release for order saga
- **Key Files:**
  - `src/infrastructure/grpc/stock.service.ts` — gRPC service handler
  - `src/domain/stock/stock.aggregate.ts` — Stock entity with transactional reserve
  - `src/infrastructure/messaging/inventory-reply.producer.ts` — Publishes reserve results to Kafka
- **Database:** `inventory` (stock, stock_reserved)
- **Topics Published:** `inventory.replies`
- **gRPC Methods:** StockService.Reserve(), StockService.Release()
- **Health Check:** GET `/health` (REST only)

### `apps/search`
- **Port:** :3004
- **Purpose:** Elasticsearch read-model consumer; full-text restaurant search
- **Key Files:**
  - `src/domain/read-model/read-restaurant.repository.ts` — Elasticsearch query abstraction
  - `src/infrastructure/elasticsearch/` — ES client & indexing
  - `src/interface/messaging/catalog-projection.consumer.ts` — Kafka consumer for catalog.events
  - `src/interface/http/search.controller.ts` — Search endpoints
- **Database:** Elasticsearch (restaurants_index)
- **Topics Consumed:** `catalog.events` (Debezium CDC)
- **Endpoints:** `/api/v1/search/restaurants`, `/api/v1/search/autocomplete`

### `apps/payment`
- **Port:** :3007
- **Purpose:** Durable payment charge via Temporal; webhook handling
- **Key Files:**
  - `src/interface/http/payment.controller.ts` — Webhook receiver (HMAC-signed)
  - `src/infrastructure/temporal/charge.workflow.ts` — Temporal workflow definition
  - `src/infrastructure/temporal/charge.activity.ts` — Charge activity (call external provider)
  - `src/infrastructure/messaging/payment-reply.producer.ts` — Publishes result to order saga
  - `src/domain/payment/payment-event.entity.ts` — Payment audit log
- **Database:** `payment` (charge_events, webhook_logs) + Temporal execution history
- **Temporal Task Queue:** `payment-charges`
- **Topics Published:** `payment.replies`
- **Endpoints:** `/api/v1/payments/webhook`

### `apps/delivery`
- **Port:** :3005
- **Purpose:** Driver assignment via Redis GEO; real-time tracking
- **Key Files:**
  - `src/application/commands/assign-driver.handler.ts` — Nearest-driver assignment
  - `src/infrastructure/redis/driver-location.store.ts` — Redis GEO key-value adapter
  - `src/interface/socket-io/driver-tracking.gateway.ts` — WebSocket live location updates
  - `src/interface/http/delivery.controller.ts` — Assignment & tracking endpoints
  - `src/infrastructure/messaging/order-confirmed.consumer.ts` — Listens to order.events
- **Database:** `delivery` (assignments, routes)
- **Redis:** driver:locations:{tenant_id} (GEOADD)
- **Topics Consumed:** `order.events`
- **Endpoints:** `/api/v1/delivery/assignments/*`, `/api/v1/delivery/nearby-drivers`, Socket.IO `/socket.io`

### `apps/media`
- **Port:** :3006
- **Purpose:** Presigned MinIO uploads; async thumbnail generation
- **Key Files:**
  - `src/application/commands/create-media-upload.handler.ts` — Returns presigned URL
  - `src/application/commands/complete-media-upload.handler.ts` — Marks upload READY
  - `src/infrastructure/minio/minio-client.adapter.ts` — MinIO presigned URL generation
  - `src/infrastructure/queue/thumbnail-generation.worker.ts` — BullMQ thumbnail job
  - `src/domain/media/media.aggregate.ts` — Media versioning state machine
- **Database:** `media` (media, media_jobs)
- **MinIO Bucket:** food-delivery (restaurant photos, etc.)
- **Job Queue:** BullMQ thumbnail-generation
- **Endpoints:** `/api/v1/media/upload`, `/api/v1/media/:id/complete`, `/api/v1/media/:id`

### `apps/notification`
- **Port:** :3012
- **Purpose:** Email/SMS/push dispatch via BullMQ; Kafka event consumer
- **Key Files:**
  - `src/infrastructure/queue/email.worker.ts` — Email job processor (nodemailer → Mailpit)
  - `src/infrastructure/queue/sms.worker.ts` — SMS stub
  - `src/infrastructure/queue/push.worker.ts` — Push notification stub
  - `src/interface/messaging/order-events.consumer.ts` — Kafka listener (order lifecycle)
  - `src/application/services/notification-dispatcher.service.ts` — Routes to appropriate queue
- **Database:** `notification` (notification_logs, notification_queue)
- **Job Queues:** BullMQ email, sms, push
- **Topics Consumed:** `order.events`
- **Email Backend:** Mailpit (:8025 dev), nodemailer SMTP (prod)
- **Endpoints:** `/api/v1/notifications/history`

### `apps/review`
- **Port:** :3009
- **Purpose:** Order reviews and restaurant ratings
- **Key Files:**
  - `src/application/commands/create-review.handler.ts` — Review submission
  - `src/domain/review/review.aggregate.ts` — Review entity
  - `src/domain/rating/rating-aggregate.ts` — Denormalized rating for fast queries
  - `src/interface/http/review.controller.ts` — Review endpoints
- **Database:** `review` (reviews, rating_aggregates)
- **Topics Published:** `review.events`
- **Endpoints:** `/api/v1/reviews/*`

### `apps/analytics`
- **Port:** :3010
- **Purpose:** Real-time order analytics via ClickHouse OLAP
- **Key Files:**
  - `src/infrastructure/clickhouse/clickhouse-client.adapter.ts` — ClickHouse client
  - `src/interface/messaging/order-events.consumer.ts` — Ingests order.events into ClickHouse
  - `src/application/queries/order-summary.handler.ts` — Summary analytics query
  - `src/interface/http/analytics.controller.ts` — Analytics endpoints
- **Database:** ClickHouse `orders_fact` (ReplacingMergeTree)
- **Topics Consumed:** `order.events`
- **Endpoints:** `/api/v1/analytics/orders`, `/api/v1/analytics/revenue`, `/api/v1/analytics/top-restaurants`

### `apps/config`
- **Port:** :3008
- **Purpose:** Dynamic per-tenant configuration and feature flags
- **Key Files:**
  - `src/domain/config-value/config-value.aggregate.ts` — Config key-value store
  - `src/application/commands/set-config.handler.ts` — Update config
  - `src/infrastructure/messaging/config-change.producer.ts` — Publish cache invalidation
  - `src/interface/http/config.controller.ts` — Config endpoints
- **Database:** `config` (config_values, feature_flags)
- **Topics Published:** `config.events`
- **Endpoints:** `/api/v1/config/values`, `/api/v1/config/flags`

### Testing (E2E per Service)

Each service has a companion `{service}-e2e` project:

```
apps/gateway-e2e/        Gateway integration tests (Testcontainers + Jest)
apps/catalog-e2e/        Catalog + outbox tests
apps/order-e2e/          Saga orchestration e2e tests
... (13 total)
```

**Pattern:** `src/{feature}.e2e.spec.ts`
- Spins up real containers (Postgres, Kafka, Redis, gRPC stubs)
- Tests HTTP + Kafka + gRPC flows end-to-end
- Cleanup via Testcontainers lifecycle

## Libs Directory (Shared Libraries)

### `libs/shared/config`
- **Purpose:** Zod-validated environment configuration
- **Exports:** `ConfigModule`, `ConfigService` (via @nestjs/config)
- **Key Files:**
  - `src/config.schema.ts` — Zod schema for all env vars
  - `src/config.factory.ts` — ConfigFactory for NestJS
- **Usage:** Imported by all 13 services

### `libs/shared/settings`
- **Purpose:** Runtime config/flags client with cache invalidation
- **Exports:** `SettingsModule`, `SettingsService`, `SettingsClient`
- **Key Files:**
  - `src/settings.service.ts` — In-memory cache with Kafka listener
  - `src/settings.provider.ts` — IoC provider for NestJS
  - `src/settings-cache-invalidation.consumer.ts` — Listens to config.events
- **Cache:** Read-through cache with TTL; invalidated on config.events
- **Usage:** Imported by all 13 services for runtime config

### `libs/shared/messaging`
- **Purpose:** Kafka client + producers/consumers
- **Exports:** `KafkaModule`, `KafkaService`, decorators `@KafkaListener`, `@KafkaProducer`
- **Key Files:**
  - `src/kafka.service.ts` — Kafka client wrapper
  - `src/kafka.module.ts` — NestJS module
  - `src/decorators/kafka-listener.decorator.ts` — Consumer decorator
  - `src/decorators/kafka-producer.decorator.ts` — Producer decorator
- **Configuration:** Via env vars (KAFKA_BROKERS)
- **Exactly-Once:** Supports exactly-once semantics via consumer groups + offsets

### `libs/shared/persistence`
- **Purpose:** TypeORM + database migrations
- **Exports:** `PersistenceModule`, `TypeOrmModule` setup, migration utilities
- **Key Files:**
  - `src/typeorm.factory.ts` — TypeORM config factory (database per service)
  - `src/migration.runner.ts` — Migration execution wrapper
  - `src/transaction-manager.ts` — Transactional context for domain events
- **Database:** PostgreSQL 18; each service has own schema/database
- **Migrations:** Via nx targets `migration-run`, `migration-generate`, `migration-revert`

### `libs/shared/observability`
- **Purpose:** OpenTelemetry instrumentation (tracing + metrics)
- **Exports:** `ObservabilityModule`, `TracingService`, `MetricsService`
- **Key Files:**
  - `src/tracing.service.ts` — Tracer provider setup
  - `src/metrics.service.ts` — Meter provider setup
  - `src/tracing.module.ts` — NestJS module
  - `src/decorators/traced.decorator.ts` — Decorator for automatic span creation
- **Exporters:** OTLP HTTP to otel-collector :4318
- **Traces:** Propagate via traceparent header (HTTP, gRPC) + custom Kafka headers

### `libs/shared/jwt`
- **Purpose:** JWT verification + claim extraction
- **Exports:** `JwtModule`, `JwtVerifier`, `JwtGuard`
- **Key Files:**
  - `src/jwt-verifier.ts` — Verify Keycloak-issued tokens
  - `src/jwt.guard.ts` — NestJS guard for route protection
  - `src/jwt-payload.decorator.ts` — Extract claims to route handlers
- **Issuer:** Keycloak (OIDC)
- **Algorithm:** RS256 (public key from Keycloak JWKS endpoint)

### `libs/shared/tenancy`
- **Purpose:** Multi-tenant data isolation
- **Exports:** `TenancyModule`, `TenantContextMiddleware`, `TenantContext`
- **Key Files:**
  - `src/tenant-context.ts` — Current tenant holder (request scope)
  - `src/tenant-context.middleware.ts` — Extract tenant_id from JWT claims
  - `src/tenant-scope.decorator.ts` — Decorator for tenant-scoped queries
- **Pattern:** Middleware extracts tenant_id from JWT; services add tenant_id to all queries

### `libs/shared/locking`
- **Purpose:** Redis advisory locks for distributed coordination
- **Exports:** `LockingModule`, `LockService`
- **Key Files:**
  - `src/lock.service.ts` — Acquire/release locks via Redis SET NX
  - `src/distributed-lock.decorator.ts` — Decorator for automatic locking
- **Use Case:** Saga reaper uses locks to ensure single reaper instance runs at a time
- **TTL:** Configurable; prevents deadlocks on crash

### `libs/shared/cache`
- **Purpose:** Redis cache-aside operations
- **Exports:** `CacheModule`, `CacheService`
- **Key Files:**
  - `src/cache.service.ts` — Get/set/invalidate operations
  - `src/cache.decorator.ts` — Decorator for method caching
- **Backends:** Redis (REDIS_URL)
- **TTL:** Configurable per key

### `libs/shared/errors`
- **Purpose:** Centralized error types + global exception filter
- **Exports:** `AppException`, `ValidationException`, `NotFoundError`, etc.
- **Key Files:**
  - `src/exceptions/app.exception.ts` — Base exception class
  - `src/exceptions/validation.exception.ts` — Validation error
  - `src/exceptions/not-found.exception.ts` — 404 error
  - `src/filters/global-exception.filter.ts` — NestJS global exception handler
- **HTTP Response Envelope:** Standardized error response format (code, message, details)

### `libs/shared/health`
- **Purpose:** Kubernetes readiness/liveness probe endpoints
- **Exports:** `HealthModule`, `HealthIndicator`
- **Key Files:**
  - `src/health.controller.ts` — GET /health, /health/live, /health/ready endpoints
  - `src/health-checks/database.check.ts` — Postgres connection check
  - `src/health-checks/kafka.check.ts` — Kafka broker connectivity check
- **Probe Mapping:** readiness = all checks passing; liveness = service running

### `libs/shared/logging`
- **Purpose:** Structured JSON logging via pino
- **Exports:** `LoggingModule`, `LoggerService`
- **Key Files:**
  - `src/logger.service.ts` — pino logger wrapper for NestJS
  - `src/logger.module.ts` — NestJS module
  - `src/pino.factory.ts` — pino config factory
- **Format:** ndjson (Loki-compatible)
- **Context:** Request ID + tenant_id + span_id propagated to all logs

### `libs/shared/contracts`
- **Purpose:** gRPC protobuf definitions + generated stubs
- **Exports:** Compiled `.proto` → `.ts` service stubs
- **Key Files:**
  - `src/proto/catalog.proto` — MenuService.ValidateMenuItems
  - `src/proto/inventory.proto` — StockService.Reserve/Release
  - `src/generated/` — Compiled gRPC stubs (auto-generated)
- **Build:** `protoc` (via Nx build target)

## Infrastructure (`infra/` Directory)

### `infra/docker-compose.yml`
- **Profiles:** core, auth, messaging, search, media, workflow, analytics, notification, observability, replica
- **Services:** Postgres, Redis, Kafka, Keycloak, Elasticsearch, ClickHouse, Temporal, Debezium, Nginx, Mailpit, otel-collector, Jaeger, Prometheus, Loki, Grafana, Alloy

### `infra/docker/Dockerfile`
- **Build:** Multi-stage (builder → deps → runtime)
- **Runtime Image:** gcr.io/distroless/nodejs24-debian12:nonroot
- **Entrypoint:** `launcher.js` (selects service via APP env var)

### `infra/nginx/`
- **nginx.conf** — Reverse proxy config; routes /api/* to gateway :3000

### `infra/postgres/`
- **init/** — Init scripts (create databases, replication setup)
- **replica-entrypoint.sh** — Replica streaming replication setup

### `infra/keycloak/`
- **realm-export.json** — Pre-configured food-delivery realm + food-delivery-spa client

### `infra/k8s/`
- **base/** — Kustomize base manifests (1 per service + shared resources)
- **overlays/** — Kustomize overlays (dev, prod)
  - dev: Lower replicas, no HPA, resource limits relaxed
  - prod: HPA enabled, strict resource requests/limits, node affinity
- **observability/** — Prometheus, Grafana, Jaeger manifests
- **rollout/** — Argo Rollouts canary/blue-green configs
- **infra-dev/** — Postgres, Redis k8s StatefulSets (dev only)

## Tools Directory

### `tools/seed/`
- **seed.ts** — CLI seeder (pnpm seed:up / pnpm seed:down)
- **Purpose:** API-driven demo data generation
- **Generates:** Tenants, restaurants, menu items, orders, drivers, media uploads, edge cases (compensation, idempotency retries)

## Bruno HTTP Collection

### `bruno/`
- **Structure:** One folder per service
- **Files:** `.bru` HTTP request definitions
- **Environment:** Local (localhost:3000)
- **Usage:** Import into Bruno → select environment → run requests

Example structure:
```
bruno/
├── Catalog/
│   ├── Create Restaurant.bru
│   ├── List Restaurants.bru
│   └── ...
├── Order/
│   ├── Place Order.bru
│   ├── List Orders.bru
│   └── ...
└── ... (per service)
```

## CI/CD Workflows (`.github/workflows/`)

### `ci.yml` (on PR + push develop/main)
- Nx affected: lint, test, build
- Biome: format check
- dependency-cruiser: boundary validation
- knip: unused imports check
- Trivy: filesystem scan (advisory)

### `cd.yml` (on push main only)
- Build & push single GHCR image
- cosign keyless sign
- SLSA provenance attestation
- Trivy image scan (blocking HIGH/CRITICAL)
- Deploy to k8s (main-gated via GitHub environment)

### `release-please.yml`
- Auto-bumps version (conventional commits)
- Manifest-driven (.release-please-manifest.json)

## Package Structure

### pnpm Workspace
- **Root:** Manages Node version (24.14+), pnpm version (10.32.1)
- **Workspace:** All apps/ and libs/shared/ are workspace members
- **Scripts:**
  - `pnpm dev` — Start all 13 services + infra
  - `pnpm test` — Run all tests
  - `pnpm lint` — Biome check
  - `pnpm db:migrate` — Run pending migrations

### Nx Configuration (`nx.json`)
- **Plugins:** @nx/webpack, @nx/jest, @nx/nest
- **Cache:** Distributed caching via NX
- **Targets:** build, serve, test, e2e, lint, migration-run, migration-generate

## Cross-Cutting Concerns

### Dependency Injection
- **NestJS Modules:** Each service exports custom modules (CatalogModule, OrderModule, etc.)
- **Shared Modules:** PersistenceModule, KafkaModule, ObservabilityModule injected by all services

### Error Handling
- **Global Filter:** GlobalExceptionFilter catches all exceptions; returns standardized envelope
- **Exception Types:** AppException, ValidationException, NotFoundError, ConflictError, InternalError

### Authentication & Authorization
- **Entry Point:** API Gateway (JWT guard)
- **Propagation:** Trusted headers (x-user-id, x-roles, x-tenant-id)
- **Enforcement:** Per-route guards; @Authorized('admin') decorator

### Database Transactions
- **Pattern:** TransactionManager in PersistenceModule wraps domain operations
- **Outbox:** Service inserts domain events + outbox record in single transaction

### Event Publishing
- **Pattern:** @KafkaProducer decorator publishes to topics
- **Retry:** BullMQ handles retries; DLQ for undeliverable messages

## Navigation Tips

1. **Find a service's HTTP endpoints:** `apps/{service}/src/interface/http/{service}.controller.ts`
2. **Find domain logic:** `apps/{service}/src/domain/*/`
3. **Find database schema:** `apps/{service}/src/infrastructure/persistence/entities/`
4. **Find Kafka consumers:** `apps/{service}/src/interface/messaging/*consumer.ts`
5. **Find a gRPC service:** `apps/{service}/src/interface/grpc/*service.ts`
6. **Find configuration:** `libs/shared/config/src/config.schema.ts`
7. **Find observability setup:** `libs/shared/observability/src/`
8. **Find CI/CD logic:** `.github/workflows/`
9. **Find k8s manifests:** `infra/k8s/base/{service}/`
10. **Find test setup:** `apps/{service}/*.e2e.spec.ts`

## Module Dependencies (Simplified)

```
gateway
  ↓ reverse-proxies to ↓
  ├─ auth (Keycloak Admin API)
  ├─ catalog (gRPC: ValidateMenuItems)
  ├─ order (Saga: Reserve, Charge, Confirm)
  │   ├─ inventory (gRPC: Reserve/Release)
  │   └─ catalog (gRPC: ValidateMenuItems)
  ├─ search (Kafka: catalog.events)
  ├─ payment (Temporal: ChargeWorkflow)
  ├─ delivery (Redis GEO; Kafka: order.events)
  ├─ media (MinIO; BullMQ)
  ├─ notification (BullMQ; Kafka: order.events)
  ├─ review (Kafka: order.events)
  ├─ analytics (Kafka: order.events)
  └─ config (Kafka: config.events)

All services ↓ depend on ↓
libs/shared/
  ├─ config (env validation)
  ├─ settings (runtime config cache)
  ├─ messaging (Kafka)
  ├─ persistence (TypeORM)
  ├─ observability (OTel)
  ├─ jwt (JWT verify)
  ├─ tenancy (tenant_id extraction)
  ├─ locking (Redis locks)
  ├─ cache (Redis cache-aside)
  ├─ errors (exception types)
  ├─ health (readiness/liveness probes)
  ├─ logging (pino structured logs)
  └─ contracts (gRPC stubs)
```

## File Naming Conventions

- **Controllers:** `{feature}.controller.ts`
- **Services:** `{feature}.service.ts`
- **Entities/Aggregates:** `{entity}.aggregate.ts`, `{entity}.orm-entity.ts`
- **Repositories:** `{entity}.repository.ts`, `{entity}-read.repository.ts`
- **Consumers:** `{topic}-or-event.consumer.ts`
- **Producers:** `{topic}-or-event.producer.ts`
- **Handlers:** `{command-or-query}.handler.ts`
- **Decorators:** `{name}.decorator.ts`
- **Filters:** `{name}.filter.ts`
- **Tests:** `{filename}.spec.ts` (unit), `{filename}.e2e.spec.ts` (integration)

## Key Configuration Files

| File | Purpose |
|------|---------|
| `.env.example` | Environment template |
| `nx.json` | Nx monorepo config |
| `.dependency-cruiser.js` | Enforce architectural boundaries |
| `.eslintrc.json` | ESLint config (minimal) |
| `biome.json` | Biome formatter + linter config |
| `.commitlintrc.json` | Conventional commit scope validation |
| `jest.config.ts` | Jest test config (base) |
| `tsconfig.base.json` | TypeScript base config + path aliases |

This summary serves as a "where is X?" reference. For detailed logic in specific services, read the corresponding source files.
