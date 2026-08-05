# Project Overview & Product Development Requirements

## Product Vision

**food-delivery-api** is a production-grade food delivery backend platform designed to serve a real-world, multi-tenant marketplace where customers order food, restaurants manage operations, drivers perform delivery, and admins oversee the system. Built on **NestJS 11** within an **Nx monorepo**, the platform prioritizes reliability, scalability, and operational visibility through event-driven architecture, distributed transactions with compensation, and comprehensive observability.

**Version:** 1.2.2 · **License:** MIT · **Repository:** github.com/ndgkhoa/food-delivery-api

## Core Personas

1. **Customer** — Places orders, tracks status, receives notifications, rates restaurants & delivery
2. **Restaurant Owner** — Creates/manages restaurant profile, menus, receives order notifications, manages fulfillment
3. **Delivery Driver** — Views assigned orders, updates location in real-time, completes deliveries
4. **Admin** — Views analytics, manages tenants, monitors system health, configures feature flags

## Core Capabilities

### Order Management
- Multi-tenant order placement with idempotent request handling
- Saga-orchestrated state machine: PENDING → RESERVED (inventory) → CONFIRMED (charged & assigned driver)
- Automatic compensation on failure; saga reaper re-drives stranded workflows
- Monthly range-partitioned order tables for performance at scale
- Exactly-once Kafka consumer guarantee via processed_events tracking

### Catalog & Search
- Restaurant and menu-item management with transactional outbox
- Debezium CDC streams catalog changes to search read-model
- Full-text search via Elasticsearch with autocomplete
- Synchronous menu validation over gRPC (east-west)

### Inventory & Reservation
- Stock reserve/release via gRPC (internal service boundary)
- Called synchronously within the order saga
- Exactly-once semantics enforced by idempotency keys

### Payment Processing
- Durable charge execution via Temporal ChargeWorkflow
- Survives service restarts and network failures
- HMAC-signed webhook for external payment reconciliation
- Configurable failure threshold for demo/testing

### Driver Dispatch & Delivery
- Near-real-time driver assignment using Redis GEO
- WebSocket-based live tracking of driver location
- Triggered on OrderConfirmed event from Kafka
- Assignment algorithm orders drivers by proximity to delivery address

### Media Management
- Presigned direct upload to MinIO (avoids server memory bottleneck)
- Async thumbnail generation via sharp + BullMQ job queue
- Metadata versioning (READY, UPLOADING, ERROR)

### Notifications
- BullMQ job queue for email/SMS/push dispatching
- Kafka consumer fan-out: Order events → Mailpit (email), SMS stub, push notifications
- Configurable retry + DLQ for failed sends

### Analytics & Reporting
- Real-time order metrics into ClickHouse (ReplacingMergeTree)
- Tenant-scoped dashboards: order counts, revenue, top restaurants
- Read-only to Kafka order.events topic

### Configuration Management
- Dynamic per-tenant configuration and feature flags
- Kafka-driven cache invalidation (`config.events`)
- Shared client library for all services

### Reviews & Ratings
- Post-delivery order reviews and restaurant ratings
- Denormalized rating aggregation for fast reads

## Non-Functional Requirements

### Multi-Tenancy
- Row-level data isolation via tenant_id foreign key
- JWT claims include tenant_id; services extract and enforce in queries
- No cross-tenant data leakage

### Consistency & Durability
- **Strong consistency** for order state via saga coordinator
- **Eventual consistency** for read-models (Elasticsearch, ClickHouse)
- Transactional outbox eliminates dual-write failures
- Exactly-once semantics via idempotency keys + processed_events table

### Scalability
- Horizontal scaling via Nx's per-service independent builds
- Read-replica for list queries (async secondary)
- HPA based on CPU/custom metrics (Prometheus) in Kubernetes
- Monthly partitioning of orders table (12 active partitions)

### Observability
- **Tracing:** OpenTelemetry instrumentation across HTTP, gRPC, Kafka
- **Metrics:** Prometheus scrape + custom HPA metrics via prometheus-adapter
- **Logs:** Structured JSON via pino, shipped to Loki
- **Visualization:** Grafana dashboards + Jaeger trace UI

### Security
- **Authentication:** Keycloak OAuth2/OIDC, JWT issued per request
- **Authorization:** RBAC (roles: customer, restaurant_owner, driver, admin)
- **API Gateway:** Single reverse-proxy entrypoint, verifies JWT, enforces rate-limit (100/60s), per-service circuit breaker
- **East-West Trust:** Kafka PLAINTEXT (dev) + gRPC signed identity headers (production-ready)
- **Image Signing:** cosign keyless attestation + SLSA provenance
- **Secret Management:** .env (dev), env vars (prod)

### Reliability
- **Circuit Breaker:** Per-service in gateway (opossum) to prevent cascading failures
- **Saga Compensations:** Automatic rollback on step failure
- **Saga Reaper:** Async process re-drives stranded sagas
- **Idempotency Keys:** Header-based request deduplication
- **Retry Logic:** Exponential backoff in BullMQ queues + Temporal activities
- **Deadletter Queues:** Undeliverable messages in `{topic}.dlq` Kafka topics

### Deployment & Operations
- **Containerization:** Single distroless image (GCR) bundles all 13 services
- **Orchestration:** Kubernetes with HPA, canary/blue-green rollouts
- **CI/CD:** GitHub Actions (nx affected build+test, Biome lint, trivy scan)
- **Image Registry:** GHCR with cosign signatures + SLSA provenance
- **Database:** PostgreSQL 18 with wal_level=logical for CDC
- **Version Management:** release-please (conventional commits) auto-bumps semver

## Technical Scope & Boundaries

### Included (v1.2.2)
- All 13 microservices fully operational
- Multi-tenant order saga with compensation
- Event-driven architecture (Kafka)
- Outbox + CDC to read-models
- Full observability stack (OTel + Jaeger + Prometheus + Loki + Grafana)
- Kubernetes deployment with HPA + canary rollouts
- Complete test suite (Jest + Testcontainers + k6 load tests)
- CLI seeder for demo data (up/down + edge-case scenarios)

### Explicitly NOT Included
- SPA/mobile client (docs refer to Bruno HTTP collection for testing)
- SMS/push notification providers (stubs for demo)
- Fraud detection
- ML-based recommendation engine
- Multi-language support
- Audit trail (logging only, not queryable audit log)

## Success Criteria & Metrics

1. **Functional Completeness**
   - All 13 services deploy and pass integration tests
   - Order saga completes end-to-end in < 5 seconds (p99)
   - Delivery driver assigned within 2 seconds of OrderConfirmed event

2. **Reliability**
   - Zero unhandled exceptions in production logs
   - Saga reaper successfully re-drives 100% of stalled workflows
   - No data loss on service restart (durable outbox + Kafka offset tracking)

3. **Scalability**
   - HPA scales gateway + order service to 10x baseline under 100 req/sec load
   - ClickHouse ingest handles 10k events/sec from analytics consumer

4. **Observability**
   - 100% of service-to-service calls traced (HTTP + gRPC + Kafka)
   - Alert rule for saga compensation (business KPI)
   - Loki queries return in < 5s for 1-week retention window

5. **Security**
   - All deployments use signed images (cosign keyless)
   - Zero exposed secrets in image layers (trivy HIGH/CRITICAL blocking)
   - RBAC enforced: only restaurant_owner can modify own restaurant data

6. **Developer Experience**
   - Onboarding time for new service < 30 minutes (from clone to running service)
   - Local docker-compose startup time < 2 minutes
   - Build time for single service < 20 seconds (nx incremental)

## Architecture Decisions (Rationale)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Service Boundary | Order aggregates, domain events | Clean separation of concerns; idempotency keys prevent duplicate processing |
| Saga Pattern | Choreography (Kafka) + reaper | Decoupled; automatic compensation on failure; reaper handles stalled workflows |
| Read-Model | Elasticsearch + ClickHouse | ES for user-facing search; ClickHouse for analytics OLAP |
| Database Strategy | PostgreSQL per service + replica | Data autonomy; replica for read-heavy list queries; logical replication for CDC |
| Event Storage | Kafka (KRaft) | Durability, replay, fan-out; no external event store needed |
| Deployment | Single image, multi-container k8s | Simplified build, versioning, and rollback; per-service HPA isolation |
| Identity | JWT + trusted headers | Stateless; edge gateway validates once, services trust headers |

## Roadmap Status

- **v1.2.2** (Current): All 13 services, full saga orchestration, observability, k8s, cosign signing
- **v1.3.0** (Planned): Multi-region deployment, cross-tenant analytics, SMS/push providers
- **v2.0.0** (Backlog): Real-time notifications (WebSocket unified hub), recommendation engine, audit trail

## References

- **Architecture:** See `docs/system-architecture.md` for C4 diagrams and data flow
- **Code Standards:** See `docs/code-standards.md` for layering, naming, and commit conventions
- **Deployment:** See `docs/deployment-guide.md` for local, k8s, and CI/CD setup
- **Codebase Map:** See `docs/codebase-summary.md` for file-by-file directory structure
