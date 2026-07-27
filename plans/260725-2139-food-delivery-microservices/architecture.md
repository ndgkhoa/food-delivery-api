# Architecture — Food Delivery Microservices

Consolidated design reference. All planning docs point here for the layering, service map, event flows, data ownership, tech versions, and monorepo layout.

## 1. Layering (Internet → Nginx → Gateway → Services)

Nginx is L7 load balancer + TLS termination ONLY. It is NOT the application gateway. The API Gateway (NestJS) owns app cross-cutting concerns.

**Trust-boundary invariant (deployment):** the gateway is the SOLE ingress that verifies JWTs and stamps trusted identity headers (`x-tenant-id`/`x-user-id`/`x-roles`). Downstream services trust those headers and therefore MUST NOT be publicly reachable — they live on the internal network behind Nginx→gateway only. Dev enforces this by convention; prod enforces it (K8s NetworkPolicy / never publishing service ports). Hardening backlog: cryptographically-signed internal identity (HMAC/JWT) or mTLS so a directly-reachable service can't be spoofed on network position alone.

```
Internet
   │  HTTPS
   ▼
┌──────────────────────────────┐
│ Nginx  (L7 LB, TLS term)     │  infra edge — no app logic
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ API Gateway (NestJS)         │  JWT verify · RBAC · versioning · rate limit
│                              │  request validation · correlation ID · logging
│                              │  circuit breaker · (opt) service discovery
└──────────────┬───────────────┘
   REST (public) / gRPC (internal, east-west)
   ▼        ▼        ▼        ▼        ▼ ...
[auth][catalog][order][inventory][payment][delivery][search]
[notification][media][analytics][review][config]
```

## 2. The 13 services (bounded contexts)

| Service | Responsibility | Key tech it teaches | Owns data |
|---------|----------------|---------------------|-----------|
| gateway | Edge cross-cutting for clients | JWT verify, RBAC, versioning, rate limit, validation, correlation ID, circuit breaker | none (stateless) |
| auth | Identity, tokens, tenants | Keycloak, OAuth2/OIDC, JWT, refresh, session, RBAC, multi-tenant | users/roles map (Keycloak), tenant registry |
| catalog | Restaurants + menus | Postgres, CQRS read side, audit log, soft delete, Redis cache, Outbox (CDC source) | restaurants, menu_items |
| search | Full-text discovery | Elasticsearch (analyzer/tokenizer/synonym/autocomplete/ranking), CDC consumer | ES indices (read model only) |
| order | Order lifecycle | Saga, state machine, Outbox, Kafka, idempotency, Redis distributed lock, optimistic lock, DB partition | orders, order_items |
| inventory | Stock reserve/release | Reservation model, split from order | stock, reservations |
| payment | Charge orchestration | Temporal workflow, retry, DLQ, idempotency, webhook, Outbox | payments, payment_attempts |
| delivery | Driver + tracking | WebSocket, Redis GEO, gRPC location stream, geo search | driver_locations, assignments |
| notification | Multi-channel messaging | Kafka consumer, BullMQ, retry, DLQ, email/SMS/push adapters | notification_log |
| media | Images | MinIO, resize, thumbnail, presigned URL | object metadata |
| analytics | Metrics/dashboards | Kafka consumer → ClickHouse → dashboard | analytics tables (ClickHouse) |
| review | Ratings | rating → Kafka → restaurant score → ES | reviews |
| config | Business values | delivery fee, VAT, discount values; feature-flag toggles | config entries, flags |

Order does NOT manage stock (inventory does). Search/analytics/review ES indices are read models — never source of truth. Debezium lives in catalog only; search just consumes events.

## 3. Key event flows

### 3.1 Catalog change → Search (Outbox → Debezium → Kafka → ES)
```
catalog write ──tx──▶ [restaurants table] + [outbox table]  (same Postgres tx)
                                   │
                    Debezium (Kafka Connect) tails WAL / outbox
                                   ▼
                          Kafka topic: catalog.events
                                   ▼
                 search consumer ──▶ transform ──▶ Elasticsearch index
```

### 3.2 Order Saga (orchestration)
```
order.create ─▶ ORDER(PENDING)
   └─ Saga orchestrator (in order svc) emits commands via Kafka:
        1. inventory.reserve   → ok / out_of_stock
        2. payment.charge      → ok / failed        (Temporal workflow in payment)
        3. delivery.assign     → ok / no_driver
   success → ORDER(CONFIRMED)     any failure → compensate in reverse:
                                    release stock, refund, cancel assign → ORDER(CANCELLED)
   Outbox in order guarantees each state transition emits exactly once.
```

### 3.3 Payment (Temporal workflow)
```
payment.charge cmd ─▶ Temporal workflow:
   activity: callProvider (retry w/ backoff)
   ├─ success ─▶ emit payment.succeeded (Outbox→Kafka)
   ├─ transient fail ─▶ Temporal retries (durable timer)
   └─ permanent fail ─▶ DLQ + emit payment.failed
   webhook from provider ─▶ signal workflow (reconcile async result)
```

## 4. Cross-cutting concerns (every service)

- **Audit log**: append-only `audit_log` per service DB; who/what/when/before/after.
- **Soft delete**: `deleted_at` nullable; default queries filter it out.
- **Multi-tenant**: `tenant_id` on every row; propagated from JWT claim via correlation context; row-level filtering in a shared Nest interceptor/repository base.
- **Correlation ID**: gateway generates `x-correlation-id`, propagated over REST headers + gRPC metadata + Kafka headers; injected into logs + traces.
- **Feature flags**: `config` service holds flag state; SDK/interceptor reads; flags only toggle, config service holds the values.
- **Contracts**: OpenAPI spec per service → OpenAPI Generator produces typed clients/DTOs in a shared lib. gRPC uses `.proto` in shared contracts.

## 5. Monorepo layout (Nx)

```
food-delivery-api/
├── nx.json  package.json  tsconfig.base.json
├── apps/
│   ├── gateway/         auth/       catalog/     search/
│   ├── order/           inventory/  payment/     delivery/
│   ├── notification/    media/      analytics/   review/    config/
│   └── *-e2e/           (per-app e2e suites)
├── libs/
│   ├── shared/config/          (env loading, validation)
│   ├── shared/logging/         (pino logger + correlation ID)
│   ├── shared/observability/   (OTel setup, tracing helpers)
│   ├── shared/tenancy/         (multi-tenant interceptor, base repo)
│   ├── shared/audit/           (audit-log helpers)
│   ├── shared/messaging/       (Kafka producer/consumer, Outbox helpers)
│   ├── shared/contracts/       (OpenAPI-generated clients + .proto/gRPC stubs)
│   ├── shared/errors/          (error types, exception filters)
│   └── shared/testing/         (test utils, fixtures, testcontainers helpers)
├── infra/
│   ├── docker-compose.yml      (profiles: core, messaging, search, auth, workflow, analytics, observability)
│   ├── nginx/                  keycloak/   debezium/   k8s/
│   └── grafana/ prometheus/ otel-collector/ loki/
└── plans/  docs/
```

Nx chosen over Turborepo: generators for NestJS apps/libs, project graph, enforced module boundaries (tag-based lint rules keep bounded contexts from importing each other's internals), `affected` builds/tests for fast CI. Teaches architecture discipline — valuable for the portfolio.

## 6. docker-compose profiles (Mac Air M4 16GB strategy)

Bring up only what a phase needs. Never run everything at once on 16GB.

| Profile | Contains | Phases | Approx RAM |
|---------|----------|--------|-----------|
| `core` (default) | Postgres 18, Redis 8, the app services, Nginx | all | ~1.5-2 GB |
| `auth` | Keycloak 26.7 + its Postgres | P1+ | ~0.7 GB |
| `messaging` | Kafka 4.x (KRaft, no ZooKeeper), Kafka Connect + Debezium 3.5 (quay.io) | P3+ | ~1.5-2 GB |
| `search` | Elasticsearch 9.4 (single node) | P4+ | ~1.5 GB |
| `workflow` | Temporal server + its Postgres, Temporal UI | P5+ | ~1 GB |
| `analytics` | ClickHouse (single node) | P6+ | ~1 GB |
| `observability` | OTel Collector, Prometheus, Grafana, Jaeger all-in-one, Loki, Alloy | P8 (stub earlier) | ~1.5 GB |

Rule: a phase's compose command lists only its needed profiles, e.g. `docker compose --profile core --profile messaging up`. Keycloak, Kafka, ES, Temporal, ClickHouse each get their OWN lightweight Postgres or embedded store to avoid coupling.

## 7. Tech versions (live-verified 2026-07-25; all images arm64-native for M4)

Package manager: **pnpm**. Full audit + sources: `plans/reports/researcher-260725-2205-stack-versions-and-images-report.md`.

| Layer | Choice | Version | Docker image:tag | Notes |
|-------|--------|---------|------------------|-------|
| Runtime | Node.js | 24.21.0 LTS | build `node:24-bookworm` → runtime `node:24-bookworm-slim` | `.nvmrc` = 24.21.0; multi-stage. AVOID alpine for apps — musl breaks native modules (bcrypt, `@grpc/grpc-js` addon, sharp) |
| Language | TypeScript | latest 5.x line (~5.9) | — | ⚠️ AVOID TS 7.0 (Go rewrite) until NestJS/Nx toolchain supports it; do NOT pin the stale 5.5.4 |
| Framework | NestJS | 11.1.28 | — | Stay on 11 — v12 (ESM/Vitest/Rspack) not GA yet (~Q3'26); migrate post-GA |
| Monorepo | Nx (`@nx/nest`) | 23.1.x | — | Enforced module boundaries |
| RDBMS | PostgreSQL | 18.4 | `postgres:18.4` (Debian bookworm — NOT alpine) | ⚠️ alpine=musl → collation/sort differs from glibc; moving data alpine↔debian can corrupt index order. Pin exact patch; Renovate bumps |
| Cache/lock/GEO | Redis | 8.8.0 (latest) | `redis:8.8.0-alpine` | alpine OK here (no native-module risk). Pin exact latest; Renovate auto-bumps to newest. ⚠️ RSALv2/SSPL license; OSS drop-in = Valkey 9.1 |
| Jobs/scheduler | BullMQ + node-cron | 5.81.x + 4.6.x | — | — |
| Broker | Apache Kafka | 4.x (KRaft) | `apache/kafka:4.0.0` | Use OFFICIAL `apache/kafka` (avoid bitnami — catalog changed). 4.1 available. No ZooKeeper |
| CDC | Debezium (Kafka Connect) | 3.5.x Final | `quay.io/debezium/connect:3.5` | 🔴 MOVED to quay.io — Docker Hub image is stale |
| Search | Elasticsearch | 9.4.4 | `docker.elastic.co/elasticsearch/elasticsearch:9.4.4` | Heap cap: `ES_JAVA_OPTS=-Xms256m -Xmx512m` |
| IdP | Keycloak | 26.7 | `quay.io/keycloak/keycloak:26.7` | ⚠️ `27.0.0` tag does NOT exist on quay.io (earlier research wrong) — 26.7 verified. Client `defaultClientScopes` MUST include `basic` (Keycloak 24+ moved the `sub` claim there) |
| Workflow | Temporal server + `@temporalio/*` SDK | SDK 1.21.x | `temporalio/auto-setup:<verify>` | 🔴 SDK jumped 1.11→1.21 — read changelog for breaking changes; verify server tag at install |
| Analytics DB | ClickHouse | 26.4.x | `clickhouse/clickhouse-server:26.4` | Behind `analytics` profile, off by default |
| Object store | MinIO | ⚠️ upstream ARCHIVED 2026-04-25 | `cgr.dev/chainguard/minio:latest` (or `ghcr.io/minio/minio`) | 🔴 `minio/minio` Docker Hub no longer gets builds — use community image; verify licensing |
| Load balancer | Nginx | 1.30.x stable | `nginx:1.30-alpine` | Pin stable, not `:latest` |
| Tracing backend | Jaeger v2 | 2.19.x | `jaegertracing/jaeger:2.19.0` | 🔴 v1 EOL 2025-12-31 — v2 is OTel-Collector-based; ports 16686 (UI) + 4317/4318 (OTLP). Verify exact v2 image name at pull |
| Instrumentation | OpenTelemetry JS SDK + Collector | api 1.9.x / sdk-node / collector 0.157.x | `otel/opentelemetry-collector-contrib:0.157.0` | Single Collector = sole OTLP sink → fans out to Jaeger/Prometheus/Loki |
| Metrics | Prometheus + Grafana | Prom v3.8.x / Grafana 13.1.x | `prom/prometheus:v3.8.1` · `grafana/grafana:13.1.1` | v3 has config breaking changes vs v2; `v2.53.x` LTS = fallback |
| Logs | Loki + Grafana Alloy | 3.7.x + latest | `grafana/loki:3.7.4` · `grafana/alloy:latest` | Alloy = log shipper |
| Contracts | OpenAPI Generator (REST) + gRPC/protobuf | CLI 2.40.x (npm wrapper) | — | — |

### 🔴 Must-not-miss corrections (were wrong/moved vs first draft)
1. **MinIO archived** → community/Chainguard image, not `minio/minio`.
2. **Jaeger v1 EOL** → migrate to v2 (`jaegertracing/jaeger:2.x`, OTLP ports).
3. **Debezium moved to quay.io** → `quay.io/debezium/connect`.
4. **Temporal TS SDK 1.11→1.21** → review breaking changes before P5.
5. **TypeScript** → stay on latest 5.x; do NOT adopt TS 7 Go rewrite yet; ignore any "pin 5.5.4" note (stale).
6. **Redis license** (RSALv2/SSPL) → Valkey 9.1 if strict-OSS needed.

Observability alternatives (documented, not chosen): **Grafana Tempo** instead of Jaeger (single LGTM pane, less standalone UI to learn); **ELK** instead of Loki (reuses search ES, but Kibana+ES-logs ~2GB+ risks OOM on 16GB). Default = Jaeger + Loki for RAM safety.

Rule for implementation: always fetch the library's current docs (context7 / docs-seeker) and re-check the image tag before coding a new integration — versions move fast; pin the real latest and follow documented usage, not memory. Running ALL compose profiles at once ≈ 13-15 GB → exceeds 16 GB comfort; bring up only the profiles a phase needs.

## 8. Dev tooling & supply chain (live-verified 2026-07-26)

Full audit: `plans/reports/researcher-260726-2254-dev-tooling-versions-and-usage-audit-report.md`. Git/PR process: `development-workflow.md`.

| Tool | Version | Install | Purpose |
|------|---------|---------|---------|
| Biome | 2.5.5 | `@biomejs/biome` (pnpm) | Format + lint + organize-imports (one `biome check`). Replaces ESLint + Prettier |
| dependency-cruiser | 18.1.0 | `dependency-cruiser` (pnpm) | Enforce module-boundary rules (bounded contexts) + graph. Replaces `@nx/enforce-module-boundaries` (Biome can't do this) |
| Knip | 6.29.0 | `knip` (pnpm) | Dead code + unused files/exports/deps |
| Lefthook | 2.1.10 | `lefthook` (brew/pnpm) | Git hooks; runs on `{staged_files}` + `stage_fixed: true` |
| Commitlint | 21.2.1 | `@commitlint/cli` + `config-conventional` | Conventional Commits + **mandatory scope**; wired via Lefthook `commit-msg` |
| Scalar | 1.2.10 | `@scalar/nestjs-api-reference` | Modern OpenAPI reference UI in NestJS |
| Bruno | 4.0.0 | `@usebruno/cli` | Git-friendly API collections (`.bru`), run in CI |
| Trivy | 0.72.0 | brew (arm64 ✅) | CVE scan: image / fs / config / k8s. Use ≥0.69.3 (verify at install) |
| Hadolint | 2.14.0 | brew (arm64 ✅) | Dockerfile lint |
| actionlint | 1.7.12+ | brew (arm64 ✅) | Lint GitHub Actions workflows |
| Renovate | 37.x+ | GitHub app + `renovate.json` | Auto dep + Docker-tag updates; pnpm-workspace aware (**replaces Dependabot**) |
| Changesets | latest | `@changesets/cli` | Changelog + versioning per project |
| pnpm | 10.30.2 | corepack (`corepack enable pnpm`) | Package manager (Node 24 bundles corepack) |

**Dropped as redundant:** ESLint/Prettier (→ Biome) · lint-staged (→ Lefthook staged-files) · Madge (→ Nx graph + cruiser) · Dependabot (→ Renovate) · CircleCI (→ GitHub Actions).

**Config files (root):** `biome.json` · `lefthook.yml` · `commitlint.config.mjs` · `knip.json` · `.dependency-cruiser.js` · `renovate.json` · `.hadolint.yaml` · `.trivyignore` · `.changeset/config.json` · `.nvmrc` · `.github/pull_request_template.md` · `.github/workflows/*`.

**Naming/commit rule (hard):** branch, commit, and PR names describe CODE CONTENT, never plan progress — the token "phase" (or finding codes) is FORBIDDEN in any git artifact. Commits use Conventional Commits with a MANDATORY scope: `type(scope): subject` (scope = service/lib, e.g. `feat(catalog): …`, `fix(order): …`, `chore(shared-config): …`). See `development-workflow.md`.
