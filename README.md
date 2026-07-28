# food-delivery-api

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24_LTS-5FA04E?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-8-FF4438?logo=redis&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Apache_Kafka-4.0-231F20?logo=apachekafka&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-HPA-326CE5?logo=kubernetes&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

Distributed **food delivery backend** in NestJS — event-driven microservices with CQRS/Saga/Outbox, full-text search, real-time tracking, durable workflows, observability, and Kubernetes ops.

## Stack

- **Runtime:** Node.js 24 LTS · TypeScript · NestJS (Nx monorepo, pnpm)
- **Data:** PostgreSQL · Redis · Elasticsearch · MinIO · ClickHouse
- **Messaging / async:** Apache Kafka (KRaft) · Debezium (CDC) · Temporal · BullMQ
- **Edge / security:** Nginx · API Gateway · Keycloak (OAuth2/OIDC) · JWT · RBAC
- **Observability:** OpenTelemetry · Jaeger · Prometheus/Grafana · Loki
- **Ops:** Docker Compose · Kubernetes (HPA, canary/blue-green) · GitHub Actions
- **Dev tooling:** Biome · dependency-cruiser · Lefthook · Commitlint · Knip · Renovate · Trivy

## Architecture

13 bounded-context services: `gateway`, `auth`, `catalog`, `search`, `order`, `inventory`, `payment`, `delivery`, `notification`, `media`, `analytics`, `review`, `config`.

- 📐 **Design:** [`architecture.md`](./plans/260725-2139-food-delivery-microservices/architecture.md) — layering, service map, event flows, data ownership, versions, dev tooling.
- 🗺️ **Roadmap:** [`plan.md`](./plans/260725-2139-food-delivery-microservices/plan.md) — phased delivery plan.
- 🔧 **Workflow:** [`development-workflow.md`](./plans/260725-2139-food-delivery-microservices/development-workflow.md) — Git Flow, Definition of Done, CI gates, commit/PR conventions.

## Getting started

**Prerequisites:** Node.js 24, pnpm, Docker. Currently running services (P0–P2): `gateway` (:3000), `catalog` (:3001 + gRPC :50051), `auth` (:3002), `inventory` (gRPC-only :50052), `order` (:3003). The rest of the 13 services are on the roadmap.

```bash
pnpm install
cp .env.example .env

# 1. Infra (Postgres + Redis + Nginx = core; Keycloak = auth). First Keycloak boot ~30-60s.
#    Postgres auto-creates the catalog/auth/inventory/order databases on first run.
#    --env-file .env is REQUIRED: the compose file lives in infra/, so Compose won't
#    pick up the repo-root .env for ${VAR} interpolation without it.
docker compose --env-file .env -f infra/docker-compose.yml --profile core --profile auth up -d

# 2. Migrate every service database
pnpm db:migrate

# 3. Run all services (each on its own port)
pnpm dev
```

**Call the API** through the **gateway** on `:3000` — the single client entry point (`/api/v1/...`). The per-service ports (3001/3002/3003) are internal; in production they sit behind the gateway.

Login is delegated to Keycloak (you don't build it). Grab a token for a seeded dev user (`owner-user` / `customer-user` / `admin-user`, password `<role>-pass`):

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/realms/food-delivery/protocol/openid-connect/token \
  -d grant_type=password -d client_id=food-delivery-spa \
  -d username=owner-user -d password=owner-pass | jq -r .access_token)

curl -X POST http://localhost:3000/api/v1/catalog/restaurants \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Pho 24","description":"..."}'
```

(Or just use the Bruno collection below — its **Auth › Login** request grabs and stores the token for you.)

**Explore / test the API:**
- **Aggregated API reference (Scalar):** `http://localhost:3000/api/v1/reference` — one UI listing every service's OpenAPI (or per-service at `:3001`/`:3002`/`:3003/api/v1/reference`). Click **Authorize** and paste the token.
- **Bruno collection** (`bruno/`): open it in [Bruno](https://usebruno.com), pick the **Local** environment, run **Auth › Login** (saves the token), then any request — all go through the gateway.

**Tests** (e2e use testcontainers — real Postgres/Redis/Keycloak/gRPC, no manual infra):

```bash
pnpm test                 # all unit tests
pnpm nx e2e order-e2e     # place/cancel/idempotency/100-concurrent no-oversell, end-to-end
```

## Contributing

Git Flow: branch off `develop` → PR into `develop` → squash-merge → delete branch. Conventional Commits with a mandatory scope (`type(scope): subject`). See the workflow doc above.

## License

[MIT](./LICENSE) © 2026 ndgkhoa
