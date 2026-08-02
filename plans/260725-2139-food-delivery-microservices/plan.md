---
title: "Food Delivery Microservices — Master Plan"
description: "Learning-oriented, enterprise-grade food-delivery backend built in 9 phased E2E slices."
status: pending
priority: P2
effort: ~200-260h (learning pace)
branch: main
tags: [microservices, nestjs, nx, kafka, distributed-systems, portfolio]
created: 2026-07-25
---

# Food Delivery Microservices — Master Plan

Greenfield distributed-systems learning project + production-grade CV portfolio. 13 bounded-context services on Nx + NestJS + TypeScript. Each phase ships a working end-to-end slice and introduces new tech ONLY when it solves a real problem. Target machine: Mac Air M4 16GB — infra split into docker-compose profiles, only bring up what a phase needs.

See [architecture.md](./architecture.md) for the layering diagram, 13-service map, event flows, data ownership, monorepo layout, pinned versions, and dev-tooling. See [development-workflow.md](./development-workflow.md) for the Agile loop, Definition of Done, CI gates, and git/commit/PR conventions (incl. the hard rule: no "phase" in any git artifact; commits carry a mandatory scope).

## Phases

| # | Phase | E2E slice delivered | Status |
|---|-------|---------------------|--------|
| 0 | [Foundation — monorepo + catalog](./phase-00-foundation-monorepo-catalog.md) | Catalog CRUD (hexagonal) over HTTP | ✅ Done (PR #1) — gateway/Nginx/OpenAPI moved to P1 |
| 1 | [Auth & Gateway hardening](./phase-01-auth-gateway-hardening.md) | Login (Keycloak) → JWT-guarded catalog | ✅ Done (PR #2–#5) |
| 2 | [Order core + Inventory](./phase-02-order-core-inventory.md) | Place order → reserve stock (gRPC) | ✅ Done (PR #6–#7) |
| 3 | [Event-driven backbone](./phase-03-event-driven-backbone.md) | Order Saga via Kafka + Outbox + CDC; catalog CQRS read model | ✅ Done (3a #10 · 3b #11 · 3c #12 · 3d) |
| 4 | [Search & Real-time & Media](./phase-04-search-realtime-media.md) | Search restaurants (ES), live driver location (WS), image upload (MinIO) | ✅ Done (4a #15 · 4b #16 · 4c #17) |
| 5 | [Payment workflow & resilience](./phase-05-payment-resilience-notification.md) | Pay order (Temporal) → notification (email/SMS) → gateway circuit breaker | ✅ Done (5a #18 · 5b #19 · 5c #20) |
| 6 | [Analytics, Review, Config](./phase-06-analytics-review-config.md) | Rating → restaurant score; revenue dashboard; dynamic fees | ✅ Done (6a #21/#22 · 6b #23/#24 · 6c #25) |
| 7 | [Data scaling](./phase-07-data-scaling.md) | Partitioned orders, read replica, cache strategies | ✅ Done (7a #26 · 7b #27 · 7c #28) |
| 8 | [Ops & Observability](./phase-08-ops-observability.md) | K8s deploy + tracing/metrics/logs across a request | 🔄 In progress (8a tracing ✅ #29; 8b metrics/logs ✅ verified · 8c K8s · 8d CI/CD next) |

## Key dependencies

- P0 → everything (monorepo, shared libs, compose profiles, contracts).
- P1 depends on P0 (gateway, catalog exist).
- P2 depends on P0 (catalog gRPC) + P1 (auth context for order ownership).
- P3 depends on P2 (order + inventory exist to orchestrate) — introduces Kafka/Outbox/Debezium.
- P4 depends on P3 (CDC events feed ES; catalog read model exists).
- P5 depends on P3 (Kafka backbone) + P2 (order state machine to hang payment off).
- P6 depends on P3 (Kafka events to consume for analytics/review) + P1 (multi-tenant).
- P7 depends on P2/P3 (real order volume + schema to partition/replicate).
- P8 depends on all (deploy + observe the whole system).

## Cross-cutting (every phase)

Audit log · soft delete · multi-tenant · correlation ID · feature flags · OpenAPI contracts. Introduced in P0/P1, applied consistently thereafter. Observability instrumentation stubbed early, fully wired in P8.

## Guiding principles

YAGNI / KISS / DRY. Simplest tech that teaches each concept. Latest stable library versions (see architecture.md tech table). Enterprise business logic and code quality throughout — this is a portfolio piece.

## Deferred (tracked backlog)

- **Global error envelope**: a shared `GlobalExceptionFilter` giving every response (400/401/403/404/500) one consistent JSON shape. Currently only `EntityNotFoundError → 404` is mapped. Do it when the gateway/auth work lands so all services + edge stay consistent — don't one-off individual codes.
- **Optimistic locking** on updates (version column) to prevent lost updates + misleading audit on concurrent PATCH. Introduce in the `order` service work (where concurrency matters); apply back to catalog then.
- Audit on cascade: a restaurant DELETE keeps a single audit entry covering its menu-item cascade (decided — not per-item).
- **Internal identity trust hardening**: services trust gateway-stamped identity headers on network isolation alone; add signed internal headers (HMAC/JWT) or mTLS so a directly-reachable service can't be spoofed. Enforce network isolation (K8s NetworkPolicy) in the ops phase. (Invariant documented in architecture.md §1.)
- **Production Keycloak realm** (tighten redirectUris/webOrigins, sslRequired=external, disable direct-grant, real client secrets) — dev realm-export is not prod-safe.
- Fully transactional user provisioning (Keycloak + registry) via Saga/Outbox — current impl is create-then-compensate best-effort.
- **Order saga reconciler**: the synchronous place-order saga (P2) can leave an order `PENDING` with a stock hold but no active order when a client abandons retries after a mid-saga failure (or a narrow concurrent-same-key/replenishment interleave). Discoverable via `status = PENDING`. P3's Kafka Saga + Outbox must reconcile/sweep these (release the hold or complete the order). No oversell/double-charge until then.
