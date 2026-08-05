# System Architecture

## High-Level Context (C4 Level 1)

The food-delivery-api is a distributed system where a public **API Gateway** fronts 13 independent NestJS microservices, each with its own database (PostgreSQL). Services communicate via **Kafka** for events and **gRPC** for synchronous east-west calls. The **Saga Orchestrator** (order service) coordinates the order-to-delivery workflow with automatic compensation. A **CDC pipeline** (Debezium) streams catalog writes to search and analytics read-models. All traces propagate via OpenTelemetry; observability is shipped to Jaeger, Prometheus, and Loki.

```
┌─────────────────────────────────────────────────────────────────┐
│                      API Clients                                 │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTPS
                        ▼
        ┌───────────────────────────────┐
        │   Nginx + API Gateway :3000   │
        │ (JWT verify, RBAC, rate-limit)│
        └───────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │  Service Mesh (Kafka + gRPC)  │
        │  ┌─────────────────────────┐  │
        │  │  13 NestJS Services     │  │
        │  │  (Each: own Postgres)   │  │
        │  └─────────────────────────┘  │
        │  ┌─────────────────────────┐  │
        │  │  CDC (Debezium)         │  │
        │  │  Read-Models (ES, CH)   │  │
        │  └─────────────────────────┘  │
        └───────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
   ┌────▼────┐              ┌──────────▼──┐
   │  Kafka  │              │   Temporal  │
   │ (KRaft) │              │ (Workflows) │
   └─────────┘              └─────────────┘
```

## Microservices Map (13 Services)

### Edge & Authentication Layer

#### **gateway** (:3000)
- **Responsibility:** Single reverse-proxy entrypoint; JWT verification; RBAC; rate-limiting; per-service circuit breaker
- **Key Patterns:** Middleware-based (NestJS Guards); opossum circuit breaker per downstream service
- **Databases:** None (stateless routing)
- **Dependencies:** Keycloak (JWT issuer), all 13 services (reverse-proxy targets)
- **Key Endpoints:** `/api/v1/*` (catch-all routing)

#### **auth** (:3002)
- **Responsibility:** Tenant CRUD; Keycloak Admin API integration; user provisioning; realm management
- **Key Patterns:** Service-to-Keycloak RPC; SASL/PLAIN provisioning
- **Databases:** None (Keycloak external state)
- **Topics Published:** None (CRUD service, no events)
- **Key Endpoints:** `/auth/tenants/*`

### Core Domain Services

#### **catalog** (:3001 + gRPC :50051)
- **Responsibility:** Restaurant & menu-item management; transactional outbox for CDC
- **Key Patterns:** Hexagonal (domain/app/infra/interface); transactional outbox; CDC consumer → search
- **Databases:** `catalog` (restaurants, menu_items, restaurant_photos, outbox)
- **gRPC Methods:** `MenuService.ValidateMenuItems()`
- **Topics Published:** `catalog.events` (restaurant_created, menu_item_added, etc.)
- **Key Entities:** Restaurant, MenuItem, MenuItemPhoto
- **Outbox Pattern:** All writes to restaurant/menu go to outbox; Debezium polls and streams to Kafka
- **Key Endpoints:** `/api/v1/restaurants/*`, `/api/v1/restaurants/:id/menus/*`

#### **order** (:3003)
- **Responsibility:** Order saga orchestrator; state machine (PENDING → RESERVED → CONFIRMED/CANCELLED); saga reaper
- **Key Patterns:** CQRS (commands: PlaceOrder; queries: ListOrders); Saga Orchestrator; idempotency keys; processed_events
- **Databases:** `order` (orders, order_items, saga_log, processed_events)
- **Partitioning:** `orders_pYYYYMM` monthly range partitions (12 active)
- **Topics Consumed:** `payment.replies` (charge result), `inventory.replies` (reserve result)
- **Topics Published:** `order.events` (order_placed, order_confirmed, order_cancelled)
- **gRPC Calls:** `inventory.ReserveStock()`, `catalog.ValidateMenuItems()`
- **Compensation:** On reserve/charge failure, auto-cancel order; reaper re-drives stuck sagas
- **Key Endpoints:** `/api/v1/orders/*` (POST: place, GET: list, GET/:id: detail)

#### **inventory** (gRPC-only :50052)
- **Responsibility:** Stock management; reserve/release for order saga
- **Key Patterns:** gRPC service (no REST); exactly-once via distributed saga
- **Databases:** `inventory` (stock, stock_reserved)
- **gRPC Methods:** `StockService.Reserve()`, `StockService.Release()`
- **Topics Published:** `inventory.replies` (to order saga)
- **Note:** Called synchronously by order saga; no public REST surface (health check only)

#### **search** (:3004)
- **Responsibility:** Full-text restaurant search; read-model consumer of catalog events
- **Key Patterns:** CQRS query model; Elasticsearch index; exactly-once via processed_events
- **Databases:** Elasticsearch (restaurants index)
- **Topics Consumed:** `catalog.events` (Debezium CDC from catalog.outbox)
- **Rebuild:** Manual via `/api/v1/search/rebuild` endpoint (re-index from catalog service)
- **Key Endpoints:** `/api/v1/search/restaurants?query=...&coordinates=...`, `/api/v1/search/autocomplete?q=...`

#### **payment** (:3007)
- **Responsibility:** Durable payment charge orchestration; Temporal workflow execution; webhook handling
- **Key Patterns:** Temporal activities (ChargeWorkflow); HMAC-signed webhook for async reconciliation
- **Databases:** None (state in Temporal execution history)
- **Temporal Task Queue:** `payment-charges` (ChargeWorkflow workers)
- **Topics Published:** `payment.replies` (to order saga)
- **Webhooks:** POST `/api/v1/payments/webhook` (from payment provider; HMAC validation)
- **Demo Threshold:** Configurable fail rate for testing compensation
- **Key Endpoints:** `/api/v1/payments/webhook`

#### **delivery** (:3005)
- **Responsibility:** Driver assignment; real-time location tracking; geo-proximity dispatch
- **Key Patterns:** Redis GEO for nearest-driver query; Socket.IO for live tracking; event consumer
- **Databases:** Redis (driver locations); `delivery` (assignments, routes)
- **Topics Consumed:** `order.events` (OrderConfirmed → trigger assignment)
- **Redis Key Pattern:** `driver:locations:tenant_id` (GEOADD)
- **Socket.IO:** `/socket.io` namespace `driver-tracking`
- **Key Endpoints:** `/api/v1/delivery/assignments/*`, `/api/v1/delivery/nearby-drivers`, `/api/v1/delivery/tracking/:order_id`

#### **media** (:3006)
- **Responsibility:** Presigned direct uploads to MinIO; thumbnail generation; metadata versioning
- **Key Patterns:** Presigned URL (POST to MinIO); async sharp job queue; metadata versioning (UPLOADING → READY)
- **Databases:** `media` (media, media_jobs)
- **MinIO Bucket:** `food-delivery` (restaurant photos, order receipts, user avatars)
- **Job Queue:** BullMQ `thumbnail-generation` (async on upload completion)
- **Versioning:** UPLOADING → (sharp) → READY or ERROR
- **Key Endpoints:** `/api/v1/media/upload` (returns presigned URL), `/api/v1/media/:id/complete`, `/api/v1/media/:id` (download metadata)

#### **notification** (:3012)
- **Responsibility:** BullMQ-driven email/SMS/push dispatch; Kafka consumer fan-out
- **Key Patterns:** Job queue with retry + DLQ; Mailpit (email), SMS stub, push stub
- **Databases:** `notification` (notification_logs, notification_queue)
- **Topics Consumed:** `order.events` (OrderPlaced → send confirmation), delivery events (OrderAssigned → driver update)
- **Job Queues:** BullMQ `email`, `sms`, `push`
- **Email Provider:** Mailpit (dev); nodemailer + SMTP (prod)
- **Key Endpoints:** `/api/v1/notifications/history` (GET user notification history)

#### **review** (:3009)
- **Responsibility:** Order reviews and restaurant ratings
- **Key Patterns:** CQRS command (CreateReview); denormalized rating reads
- **Databases:** `review` (reviews, rating_aggregates)
- **Topics Published:** `review.events` (review_created, rating_updated)
- **Key Endpoints:** `/api/v1/reviews/*` (POST: create, GET: list by restaurant/order)

#### **analytics** (:3010)
- **Responsibility:** Real-time order metrics and business intelligence
- **Key Patterns:** Kafka consumer → ClickHouse OLAP; tenant-scoped read-only queries
- **Databases:** ClickHouse `orders_fact` (ReplacingMergeTree table)
- **Topics Consumed:** `order.events` (order_placed, order_confirmed, order_cancelled)
- **ClickHouse Schema:** (order_id, tenant_id, restaurant_id, status, amount, timestamp, version)
- **Key Endpoints:** `/api/v1/analytics/orders` (summary), `/api/v1/analytics/revenue` (tenant revenue), `/api/v1/analytics/top-restaurants` (rankings)

#### **config** (:3008)
- **Responsibility:** Dynamic per-tenant configuration and feature flags; cache invalidation
- **Key Patterns:** Runtime config store; Kafka-driven invalidation; shared `settings` library consumer
- **Databases:** `config` (config_values, feature_flags)
- **Topics Published:** `config.events` (config_updated, flag_toggled)
- **Cache Clients:** All 13 services subscribe to `config.events` to invalidate local cache
- **Key Endpoints:** `/api/v1/config/values` (GET tenant config), `/api/v1/config/flags` (GET feature flags)

### Observability & Infrastructure

#### **Temporal Workflow Engine** (:7233)
- **Namespace:** `default`
- **Task Queue:** `payment-charges` (payment ChargeWorkflow)
- **Purpose:** Durable payment processing (survives service restarts)
- **Workflows:** `ChargeWorkflow` (activity: charge, retry logic, compensation)

#### **Debezium CDC** (Kafka Connect, polls catalog.outbox)
- **Source:** Catalog service `outbox` table (logical decoding)
- **Sink:** Kafka `catalog.events` topic
- **Pattern:** Outbox Relay; guarantees exactly-once delivery
- **Registration:** Manual curl to Debezium Connect API on startup

#### **Redis**
- **Uses:** Rate-limit counters (gateway), driver geo-locations (delivery), settings cache, cache-aside
- **Key Patterns:** TTL on rate-limit keys; GEOADD for driver locations; HGET for config cache
- **Ports:** :6379 (internal)

## Data Ownership & Database Boundaries

| Service | Database | Tables | Notes |
|---------|----------|--------|-------|
| **catalog** | catalog | restaurants, menu_items, restaurant_photos, outbox, read_model | Outbox → Debezium → search/analytics |
| **order** | order | orders (partitioned pYYYYMM), order_items, saga_log, processed_events | Monthly partitions; saga state persisted |
| **inventory** | inventory | stock, stock_reserved | Transactional reserve/release |
| **search** | (Elasticsearch) | restaurants_index | Denormalized read-model; rebuilt from catalog events |
| **delivery** | delivery | assignments, routes, driver_assignments | Redis also holds live geo-locations |
| **media** | media | media, media_jobs | MinIO holds actual bytes |
| **notification** | notification | notification_logs, notification_queue | Email/SMS/push audit trail |
| **review** | review | reviews, rating_aggregates | Denormalized for fast rating queries |
| **analytics** | (ClickHouse) | orders_fact | OLAP table; ReplacingMergeTree version 2 for mutations |
| **config** | config | config_values, feature_flags | Per-tenant runtime config |
| **auth** | (Keycloak) | — | External OIDC provider; no direct DB access |
| **payment** | (Temporal) | — | State in workflow execution history |

## Event-Driven Communication Map

### Kafka Topics

| Topic | Producer | Consumers | Format | Purpose |
|-------|----------|-----------|--------|---------|
| `catalog.events` | Debezium (outbox CDC) | search, analytics | Avro (schema registry if present, else JSON) | Catalog state propagation |
| `order.events` | order service | delivery, notification, analytics, review | JSON | Order lifecycle events (placed, confirmed, cancelled) |
| `inventory.replies` | inventory service | order service | JSON | Response to reserve request |
| `payment.replies` | payment service | order service | JSON | Response to charge request |
| `review.events` | review service | analytics | JSON | Rating aggregation |
| `config.events` | config service | all services (via settings lib) | JSON | Cache invalidation signal |
| `*.dlq` | Any service | Dead letter handler | JSON | Undeliverable messages (manual review) |

### gRPC East-West Calls

| Caller | Callee | Method | Purpose | Sync/Async |
|--------|--------|--------|---------|-----------|
| order | inventory | StockService.Reserve() | Check & hold stock for order | Sync |
| order | inventory | StockService.Release() | Release hold on order cancel | Sync |
| order | catalog | MenuService.ValidateMenuItems() | Verify items exist & current price | Sync |

## Order Saga Orchestration Flow (Sequence Diagram)

```
Client                    Order Service              Inventory          Kafka        Payment         Delivery
  │                            │                         │               │              │               │
  ├─ POST /api/orders ────────>│                         │               │              │               │
  │                            │                         │               │              │               │
  │                    [PENDING state]                   │               │              │               │
  │                            │                         │               │              │               │
  │                            ├─ gRPC Reserve ────────>│               │              │               │
  │                            │<──── Lock Stock ────────┤               │              │               │
  │                   [RESERVED state]                   │               │              │               │
  │                            │                         │               │              │               │
  │                            ├──────────── Publish order.events ──────>│              │               │
  │                            │                         │               │              │               │
  │                            │                         │         ┌─────────────────>│               │
  │                            │                         │         │ Charge workflow │               │
  │                            │                         │         │ (Temporal)      │               │
  │                            │<──────── payment.replies ──────────────┤               │               │
  │                   [CONFIRMED state]                  │               │              │               │
  │                            │                         │               │              │               │
  │                            │───────────────────────────────────────────────────────────────────>│
  │                            │                         │               │              │ Redis GEO     │
  │                            │                         │               │              │ Assign driver │
  │<─ 200 OK (order_id) ───────┤                         │               │              │               │
  │                            │                         │               │              │               │
  │ [Saga complete in ~5s]     │                         │               │              │               │
```

On **failure** at any stage:
1. Order saga sets order.status = CANCELLED
2. Inventory release triggered
3. Saga reaper (`SagaReaperJob`) periodically queries stalled sagas and retries

## Outbox + CDC Flow

```
Catalog Write                    Debezium                     Search / Analytics
     │                                │                              │
     ├─ INSERT restaurant ────────────┤                              │
     │                                │                              │
     ├─ INSERT outbox record ─────────┤                              │
     │  (transactional)               │                              │
     │                                ├─ Poll outbox ──────────────>│
     │                                │                              │
     │                                │ [CDC published to Kafka]      │
     │                                │                              │
     │                                │  ┌──────────────────────────┐
     │                                │  │ Search re-indexes        │
     │                                │  │ Analytics ingests fact   │
     │                                │  └──────────────────────────┘
     │ [Guaranteed delivery]           │
```

**Pattern Benefits:**
- No dual-write failures (write-or-fail atomicity in outbox)
- Order preserved (Debezium maintains LSN order)
- Idempotent consumers (processed_events table ensures exactly-once)

## Hexagonal Service Layering

Each service follows the same internal structure:

```
service-name/
├── src/
│   ├── domain/                # Business logic; no framework dependencies
│   │   ├── {aggregate}/       # Entity roots (e.g., Order, Restaurant)
│   │   ├── services/          # Domain services (coordination logic)
│   │   ├── repositories/      # Port interfaces (abstract data access)
│   │   └── events/            # Domain events (e.g., OrderPlaced)
│   ├── application/           # Use cases; orchestrates domain
│   │   ├── commands/          # CQRS write handlers
│   │   ├── queries/           # CQRS read handlers
│   │   ├── dto/               # Command/Query input/output models
│   │   └── saga/              # Saga orchestrators (order service only)
│   ├── infrastructure/        # Framework & external adapters
│   │   ├── persistence/       # TypeORM entities, repositories (adapter impl)
│   │   ├── messaging/         # Kafka consumers, producers
│   │   └── external/          # HTTP clients, gRPC stubs
│   ├── interface/             # Entry points
│   │   ├── http/              # NestJS Controllers
│   │   ├── grpc/              # gRPC service handlers
│   │   └── cli/               # Command-line (if any)
│   └── config/                # Environment & Zod schema
└── src-e2e/                   # Testcontainers e2e tests
```

**Dependency Rule:** domain → application → infrastructure ← interface
(Interface depends on infrastructure but NOT on domain/application for decoupling)

## Observability Topology

### Tracing
- **Instrumentation:** Auto-instrumentation (OpenTelemetry Node SDK) + manual spans for business logic
- **Propagation:** traceparent header (HTTP), grpc-trace-bin (gRPC), custom headers in Kafka
- **Exporter:** OTLP HTTP to otel-collector :4318 → Jaeger
- **Scope:** Distributed traces span order → inventory → payment → delivery workflows

### Metrics
- **Collection:** Prometheus scrape (:9090) of `/metrics` endpoints
- **Custom Metrics:** HPA via prometheus-adapter (e.g., `order_saga_duration_seconds` for scale decisions)
- **Libraries:** pino (logs), @opentelemetry/sdk-metrics

### Logs
- **Format:** Structured JSON (pino, ndjson)
- **Shipper:** Alloy → Loki :3100
- **Queries:** Grafana → Loki PromQL

## Kubernetes Deployment Topology

### File Structure
```
infra/k8s/
├── base/                  # Shared k8s manifests (Deployments, Services, ConfigMaps)
│   ├── gateway/
│   ├── catalog/
│   ├── order/
│   ├── ... (13 services)
│   ├── network-policies/  # RBAC + NetworkPolicy for service isolation
│   └── internal-identity/ # ServiceAccount + RBAC for east-west trust
├── overlays/
│   ├── dev/               # Dev overrides (resource limits, replica counts)
│   └── prod/              # Prod overrides (HPA, resource requests, node affinity)
├── infra-dev/             # Infrastructure (Postgres, Redis, etc.) k8s manifests
├── observability/         # Prometheus + Jaeger + Loki + Grafana manifests
└── rollout/               # Argo Rollouts canary + blue-green strategies
```

### HPA & Scaling
- **Metrics:** CPU (default), custom (via prometheus-adapter)
- **Policy:** One HPA per Deployment (per service)
- **Replicas:** 2–10 (dev), 3–20 (prod)
- **Scale-down delay:** 300s

### Rollout Strategy
- **Canary:** 10% → 50% → 100% traffic over 10 minutes
- **Blue-Green:** Parallel deployments, instant cutover
- **Validation:** Automated smoke tests on canary before full rollout

## Security Boundaries

### Trust Zones

| Zone | Services | Trust | Auth Method |
|------|----------|-------|------------|
| **Public** | Gateway | Untrusted clients | JWT (Keycloak-issued) |
| **Internal** | All 13 services | Trusted (same cluster) | Signed identity headers (x-user-id, x-roles, x-tenant-id from gateway) |
| **Admin** | Temporal UI, Grafana | Team-only (VPN/firewall) | Local credentials |

### Network Policies
- **Ingress:** Only gateway accepts external traffic (:80, :3000)
- **Egress:** Services reach Kafka, Postgres, Redis (controlled CIDR ranges)
- **East-West:** Service-to-service allowed via NetworkPolicy selectors

## Failure Scenarios & Recovery

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| Order saga stalls (inventory fails) | Saga log timeout | Saga reaper re-drives (exponential backoff) |
| Catalog outbox not drained | Monitoring alert on outbox size | Manual Debezium restart + resync |
| Elasticsearch out of sync | Search returns 0 results for known restaurants | Rebuild endpoint (`/api/v1/search/rebuild`) re-indexes from catalog |
| Payment charge timeout | Temporal execution timeout | Activity retry (max 3), then saga compensation + manual review |
| Driver location stale (Redis crash) | Delivery service reconnects, re-GEO-ADDS | Next assignment query hits Postgres, falls back to distance query |
| Notification queue overflow | BullMQ queue size monitoring | Manual pause + process DLQ + resume |

## Deployment Environments

| Env | Infra | Secrets | Observability | Scale |
|-----|-------|---------|---------------|-------|
| **Local** | docker-compose (all profiles) | .env (dev defaults) | Optional (add `--profile observability`) | 1 replica per service |
| **Dev k8s** | k3d + manifests/infra-dev | env vars + Sealed Secrets | Full (Prometheus + Jaeger + Loki + Grafana) | 2–3 replicas per service |
| **Prod k8s** | EKS/GKE + manifests/overlays/prod | HashiCorp Vault / AWS Secrets | Full + custom dashboards | HPA 3–20 replicas per service |

## References

- **Code Layout:** See `docs/codebase-summary.md` for file-by-file module map
- **Code Standards:** See `docs/code-standards.md` for layering rules and naming conventions
- **Deployment Guide:** See `docs/deployment-guide.md` for setup and CI/CD pipeline details
