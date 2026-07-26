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

## Contributing

Git Flow: branch off `develop` → PR into `develop` → squash-merge → delete branch. Conventional Commits with a mandatory scope (`type(scope): subject`). See the workflow doc above.

## License

[MIT](./LICENSE) © 2026 ndgkhoa
