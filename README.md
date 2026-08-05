# food-delivery-api

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white&labelColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white&labelColor=black)
![Node.js](https://img.shields.io/badge/Node.js-24_LTS-5FA04E?logo=nodedotjs&logoColor=white&labelColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white&labelColor=black)
![TypeORM](https://img.shields.io/badge/TypeORM-1.0-FE0902?logo=typeorm&logoColor=white&labelColor=black)
![Apache Kafka](https://img.shields.io/badge/Apache_Kafka-4.0-231F20?logo=apachekafka&logoColor=white&labelColor=black)
![Redis](https://img.shields.io/badge/Redis-8-FF4438?logo=redis&logoColor=white&labelColor=black)
![Temporal](https://img.shields.io/badge/Temporal-durable-000000?logo=temporal&logoColor=white&labelColor=black)
![Elasticsearch](https://img.shields.io/badge/Elasticsearch-9-005571?logo=elasticsearch&logoColor=white&labelColor=black)
![gRPC](https://img.shields.io/badge/gRPC-east--west-244B5A?logo=grpc&logoColor=white&labelColor=black)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-Traces-425CC7?logo=opentelemetry&logoColor=white&labelColor=black)
![Docker](https://img.shields.io/badge/Docker-GHCR-2496ED?logo=docker&logoColor=white&labelColor=black)
![Kubernetes](https://img.shields.io/badge/Kubernetes-HPA-326CE5?logo=kubernetes&logoColor=white&labelColor=black)
![Jest](https://img.shields.io/badge/Jest-Testcontainers-C21325?logo=jest&logoColor=white&labelColor=black)
![Biome](https://img.shields.io/badge/Biome-Lint_+_Format-60A5FA?logo=biome&logoColor=white&labelColor=black)

[![CI](https://github.com/ndgkhoa/food-delivery-api/actions/workflows/ci.yml/badge.svg)](https://github.com/ndgkhoa/food-delivery-api/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ndgkhoa/food-delivery-api?sort=semver&label=release&color=orange)](https://github.com/ndgkhoa/food-delivery-api/releases)
[![codecov](https://codecov.io/gh/ndgkhoa/food-delivery-api/graph/badge.svg)](https://codecov.io/gh/ndgkhoa/food-delivery-api)
[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)

Distributed **food delivery microservices backend** in NestJS — services on an Nx monorepo talking over Kafka, coordinated by a saga orchestrator with compensating transactions, a transactional outbox relayed to Elasticsearch via Debezium CDC, database-per-service Postgres, durable payments on Temporal, geo-based driver dispatch on Redis GEO, idempotent APIs, and end-to-end OpenTelemetry tracing — shipped on Kubernetes with cosign-signed images and SLSA provenance.

## Stack

- **Runtime:** Node.js 24 LTS · TypeScript 5.9 · NestJS 11 (Nx monorepo · pnpm)
- **Patterns:** Clean/Hexagonal · CQRS · Saga orchestration · Transactional Outbox · database-per-service
- **Data:** PostgreSQL 18 (TypeORM) · Redis · Elasticsearch · ClickHouse · MinIO
- **Messaging / async:** Apache Kafka (KRaft) · Debezium (CDC) · Temporal · BullMQ · gRPC (east-west)
- **Edge / security:** Nginx · API Gateway · Keycloak (OAuth2/OIDC) · JWT · RBAC · HMAC-signed identity
- **Observability:** OpenTelemetry · Jaeger · Prometheus / Grafana · Loki · Alloy
- **Ops:** Docker Compose · Kubernetes (HPA · canary / blue-green) · GitHub Actions · cosign · SLSA
- **Dev tooling:** Biome · dependency-cruiser · Lefthook · Commitlint · Knip · Renovate · Trivy

## Architecture

```
  ┌───────────────────────────────────────────────┐
  │              Nginx + API Gateway              │  JWT · RBAC · rate-limit · circuit-breaker · proxy
  └───────────────────────┬───────────────────────┘
                          │
  ┌───────────────────────┼───────────────────────┐
  │  catalog · order · inventory · payment        │
  │  delivery · media · search · review           │
  │  analytics · notification · config · auth     │
  └───────────────────────┬───────────────────────┘
                          │  events / commands
  ┌───────────────────────┴───────────────────────┐
  │                     Kafka                     │  order.events · <svc>.commands/replies · *.dlq
  └───────────────────────────────────────────────┘

  place order ─► saga: reserve stock (inventory gRPC) ─► charge (payment → Temporal)
                 ─► CONFIRMED ─► fan-out: delivery (Redis GEO) · notification · analytics
  catalog write ─► outbox ─► Debezium CDC ─► Kafka ─► search read-model (Elasticsearch)
```

- **Gateway** is the only public edge — verifies Keycloak-issued JWTs, enforces RBAC + rate-limiting + a per-service circuit breaker, and reverse-proxies to services with the verified identity attached as trusted headers.
- **Order saga** orchestrates a distributed transaction (reserve → charge → confirm) with compensation on failure; a reaper re-drives stranded sagas. Idempotency keys + a `processed_events` table keep every step exactly-once.
- **Outbox + Debezium CDC** ship catalog changes to the search read-model with no dual-write, following the `<service>.events` topic convention.
- **Temporal** guarantees the payment charge completes across crashes; **Redis GEO** powers nearest-driver dispatch.

## Getting started

```bash
# prerequisites: Node 24.14+, pnpm 10.32+, Docker
pnpm install
cp .env.example .env

# bring up the full infra stack
docker compose --env-file .env -f infra/docker-compose.yml \
  --profile core --profile auth --profile messaging --profile search --profile media \
  --profile workflow --profile analytics --profile notification up -d

# run migrations, then all services
pnpm nx run-many -t serve

# seed demo data
pnpm --filter @tools/seed seed:up
```

- **Gateway:** `http://localhost:3000/api/v1` · **Aggregated API reference (Scalar):** `/api/v1/reference`
- **Keycloak** `:8080` (`admin/admin`) · **MinIO** `:9001` · **Temporal UI** `:8233` · **Mailpit** `:8025`
- **API collection:** import [`bruno/`](bruno/) into [Bruno](https://usebruno.com) → select the `Local` environment → run **Auth › Login** (stores the token) → any request.
- **Observability**: add `--profile observability` → Grafana `:3030` · Jaeger `:16686` · Prometheus `:9090`.

## Project structure

```
apps/         services (+ *-e2e) — hexagonal: domain · application · infrastructure · interface
libs/shared/  reusable libraries — config · messaging · persistence · observability · jwt · tenancy
infra/        docker-compose · k8s · keycloak realm · prometheus · grafana · k6 · Dockerfile
bruno/        HTTP collection
tools/seed/   API-driven demo-data seeder
docs/         project documentation
```

## Testing

```bash
pnpm nx affected -t test       # unit tests (Jest)
pnpm nx run <service>-e2e:e2e  # e2e against real infra (Testcontainers)
k6 run infra/k6/load-test.js   # load test (SLO-aligned thresholds)
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [project-overview-pdr.md](docs/project-overview-pdr.md) | Product overview & requirements |
| [system-architecture.md](docs/system-architecture.md) | Services, data flow, patterns |
| [codebase-summary.md](docs/codebase-summary.md) | Module-by-module map |
| [code-standards.md](docs/code-standards.md) | Conventions & structure |
| [deployment-guide.md](docs/deployment-guide.md) | Compose & Kubernetes ops |
| [project-roadmap.md](docs/project-roadmap.md) | Milestones & progress |

## License

[MIT](LICENSE) © 2026 ndgkhoa
