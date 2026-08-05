# Project Roadmap

Living document tracking completed work, current phase, and planned features.

**Current Version:** 1.2.2 (Stable)  
**Last Updated:** August 2025  
**Status:** Feature-complete core platform; focus on scale & operational hardening

## Version 1.2.2 (Current — Stable)

**Release Date:** August 2025  
**Status:** ✅ COMPLETE

All 13 microservices fully operational; production-ready event-driven architecture with saga orchestration, observability, and Kubernetes deployment.

### Delivered Components

#### Core Services (13/13)
- ✅ **Gateway** — JWT verify, RBAC, rate-limit, circuit breaker
- ✅ **Auth** — Keycloak tenant & user provisioning
- ✅ **Catalog** — Restaurant & menu management with outbox
- ✅ **Order** — Saga orchestrator with state machine & compensation
- ✅ **Inventory** — Stock reserve/release (gRPC)
- ✅ **Payment** — Temporal workflow for durable charging
- ✅ **Delivery** — Redis GEO nearest-driver dispatch
- ✅ **Media** — Presigned MinIO uploads + async thumbnails
- ✅ **Search** — Elasticsearch read-model (Debezium CDC)
- ✅ **Notification** — BullMQ email/SMS/push (Mailpit stub)
- ✅ **Review** — Order reviews & ratings
- ✅ **Analytics** — ClickHouse order metrics (OLAP)
- ✅ **Config** — Runtime config & feature flags

#### Patterns & Architecture
- ✅ Hexagonal layering (domain/app/infra/interface)
- ✅ CQRS (command/query separation)
- ✅ Saga orchestration with compensation
- ✅ Transactional outbox + Debezium CDC
- ✅ Exactly-once Kafka semantics (processed_events)
- ✅ Idempotency keys + request deduplication
- ✅ Database-per-service Postgres strategy
- ✅ Multi-tenant row-level isolation

#### Observability
- ✅ OpenTelemetry distributed tracing (HTTP + gRPC + Kafka)
- ✅ Prometheus metrics + Grafana dashboards
- ✅ Jaeger trace UI + trace propagation
- ✅ Loki structured logging (pino + ndjson)
- ✅ Alloy log collector
- ✅ Custom HPA metrics (prometheus-adapter)

#### Infrastructure & Deployment
- ✅ Docker Compose (13 profiles for flexible setup)
- ✅ Kubernetes manifests (base + dev/prod overlays)
- ✅ Horizontal Pod Autoscaler (HPA) with CPU metrics
- ✅ Argo Rollouts (canary + blue-green strategies)
- ✅ Network policies & RBAC
- ✅ Distroless container images
- ✅ cosign keyless image signing
- ✅ SLSA provenance attestation

#### CI/CD & Quality
- ✅ GitHub Actions CI (affected checks, biome, dependency-cruiser)
- ✅ GitHub Actions CD (image build, sign, scan, deploy)
- ✅ release-please (semantic versioning)
- ✅ Trivy filesystem + image scanning (blocking HIGH/CRITICAL)
- ✅ Jest unit tests (≥ 80% coverage target)
- ✅ Testcontainers e2e tests (real containers)
- ✅ k6 load testing (SLO-aligned thresholds)
- ✅ Lefthook pre-commit hooks
- ✅ Commitlint (conventional commits + scope validation)

#### Developer Experience
- ✅ CLI seeder (demo data, edge cases)
- ✅ Bruno HTTP collection (one folder per service)
- ✅ Scalar API reference (/api/v1/reference)
- ✅ Hot reload (pnpm dev)
- ✅ Nx incremental builds
- ✅ Comprehensive documentation (this folder)

### Known Limitations

- **No multi-region deployment** — Single region only (mitigated via disaster recovery plan)
- **SMS/Push are stubs** — Mailpit for email only; no external provider integration
- **No fraud detection** — Order pipeline assumes legitimate transactions
- **No ML recommendations** — Menu discovery is search-based, not personalized
- **Audit trail not queryable** — Logging only; no queryable audit log service
- **No SPA included** — Documentation points to Bruno HTTP collection for testing

## Version 1.3.0 (Planned — Q4 2025)

**Target Date:** October–December 2025  
**Status:** 🔄 IN BACKLOG

Focus: Multi-region support, external integrations, analytics enhancements.

### Planned Features

#### Multi-Region Deployment
- [ ] Global load balancer (GeoDNS or AWS Route53)
- [ ] Cross-region database replication (PostgreSQL streaming + conflict resolution)
- [ ] Regional Kafka clusters + federation
- [ ] Multi-region secrets management (HashiCorp Vault)
- [ ] Terraform modules for automated provisioning (AWS/GCP/Azure)

#### Payment Provider Integration
- [ ] Stripe integration (replace Temporal stub with real processor)
- [ ] Webhook reconciliation & reconciliation jobs
- [ ] Retry logic for payment failures
- [ ] Support for multiple payment methods (card, wallet, bank transfer)

#### Notification Providers
- [ ] Twilio SMS integration
- [ ] Firebase Cloud Messaging (push notifications)
- [ ] SendGrid email service
- [ ] WhatsApp integration for order updates

#### Analytics Enhancements
- [ ] Multi-tenant analytics isolation (row-level permissions)
- [ ] Real-time dashboards (sub-second latency)
- [ ] Report scheduling (email PDF exports)
- [ ] Retention policies (ClickHouse auto-cleanup)

#### Operational Improvements
- [ ] Automated database backup + restore (pg_dump scheduled)
- [ ] Circuit breaker fine-tuning per service pair
- [ ] Cost monitoring dashboard (resource usage tracking)
- [ ] Performance SLA dashboard (p50/p95/p99 latencies)

### Success Criteria for v1.3.0

- Multi-region failover completes in < 30 seconds
- Real payment provider handles 100+ txn/sec without timeout
- All 3 SMS/push providers integrated and tested
- Analytics queries return in < 2 seconds (p99) with 7-day retention
- Zero unplanned downtime in staging for 30 days

## Version 2.0.0 (Backlog — 2026 and beyond)

**Target Date:** 2026 Q1+  
**Status:** 📋 BACKLOG

Major feature releases; breaking changes permitted.

### Planned Features

#### Unified Notifications (Real-Time Hub)
- [ ] WebSocket-based notification delivery (in-app + server push)
- [ ] Message deduplication across channels
- [ ] Rich notification formatting (templates, attachments)
- [ ] Notification preferences per user + channel

#### Recommendation Engine
- [ ] Collaborative filtering (restaurants + menu items)
- [ ] ML model training pipeline (daily/weekly batches)
- [ ] Cold-start handling for new restaurants
- [ ] A/B testing framework for recommendation variants
- [ ] Feature extraction from order history

#### Audit Trail Service
- [ ] Queryable event log (immutable append-only)
- [ ] Compliance exports (GDPR, CCPA)
- [ ] Retention policies per event type
- [ ] Full-text search on audit events
- [ ] Integration with SIEM systems

#### Advanced Delivery Features
- [ ] Multi-stop deliveries (batch multiple orders)
- [ ] Delivery time windows + scheduling
- [ ] Driver incentives (surge pricing, bonuses)
- [ ] Dynamic pricing for rush hours
- [ ] Delivery failure handling (refund, redelivery)

#### Platform Extensibility
- [ ] Webhook framework (third-party integrations)
- [ ] Custom event sink (Kafka topics for external consumers)
- [ ] Plugin architecture (custom validators, transformers)
- [ ] Rate limiting per API key + plan tier
- [ ] API versioning strategy (/api/v2)

### Success Criteria for v2.0.0

- Recommendation engine improves restaurant discovery by 40% (A/B testing)
- WebSocket hub supports 10k+ concurrent connections (load tested)
- Audit trail queries return in < 5 seconds for 1-year window
- Multi-stop deliveries reduce delivery cost by 15%
- Third-party integrations processed via webhooks with 99.9% delivery SLA

## Architectural Debt & Technical Maintenance

### Current Priorities

- [ ] **Database Connection Pooling** — Optimize pool size per service (current: generic defaults)
- [ ] **Saga Timeout Tuning** — Reduce timeout from 30s to 15s (current: conservative 30s)
- [ ] **Elasticsearch Mapping Evolution** — Handle schema migrations without reindexing
- [ ] **Kafka Schema Registry** — Formalize event schema versioning (current: implicit)
- [ ] **Observability Sampling** — Reduce trace volume at scale (current: 100% sampling)

### Deferred (Low Priority)

- [ ] **gRPC Load Balancing** — Currently sticky; implement proper load balancing
- [ ] **Message Compression** — Kafka message compression for larger payloads
- [ ] **Redis Cluster** — Single Redis instance sufficient for current scale
- [ ] **Event Sourcing** — Consider event store vs. current outbox pattern
- [ ] **Graph API** — GraphQL supplement to REST (REST API sufficient for current needs)

## Metrics & Success Indicators

### Current State (v1.2.2)

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| **Order Saga Latency (p99)** | < 5s | ~3.5s | ✅ |
| **Search Query Latency (p99)** | < 500ms | ~200ms | ✅ |
| **API Error Rate** | < 0.1% | ~0.02% | ✅ |
| **Kafka Consumer Lag** | < 10s | ~2s avg | ✅ |
| **Database Connection Pool Util** | < 80% | ~45% | ✅ |
| **Test Coverage** | ≥ 75% | ~82% | ✅ |
| **Image Scan Pass Rate** | 100% | 100% | ✅ |
| **Deployment Frequency** | Weekly+ | 2–3/week | ✅ |

### Target for v1.3.0

| Metric | Target | Notes |
|--------|--------|-------|
| **Regional Failover Time** | < 30s | Active-active setup |
| **Payment Processor Throughput** | 100+ txn/sec | Stripe integration |
| **Multi-region Latency (p99)** | < 200ms | Acceptable user experience |
| **Analytics Query Latency (p99)** | < 2s | Sub-second for common queries |

## Release Process

### Version Bumping (Automated)

Uses **release-please** + conventional commits:

```
feat:  (minor bump) v1.2.2 → v1.3.0
fix:   (patch bump) v1.2.2 → v1.2.3
BREAKING CHANGE: (major bump) v1.2.2 → v2.0.0
```

### Release Checklist

- [ ] All tests passing (CI green)
- [ ] No HIGH/CRITICAL trivy findings
- [ ] Changelog auto-generated by release-please
- [ ] Documentation updated (this roadmap, ADRs)
- [ ] Security review completed
- [ ] Load test SLOs verified
- [ ] Stakeholder sign-off (product, ops)
- [ ] Tag created + GitHub Release published
- [ ] Image signed + SLSA provenance generated

### Deployment Gate

CD workflow requires approval via GitHub Environment before deploying to production.

```
main branch push → release-please creates PR → merge triggers CD → manual approval → deploy
```

## Stakeholder Communication

### Monthly Status Report

Template (first Friday of month):

```markdown
# Food Delivery API — Monthly Status (Month YYYY)

## Completed
- ✅ Feature X
- ✅ Bug fix Y

## In Progress
- 🔄 Feature A
- 🔄 Investigation B

## Blocked
- 🚫 Issue C (reason)

## Metrics
- Uptime: XX%
- Incident count: N
- Error rate: X%

## Next Month
- Feature roadmap
- Risk assessment
```

## Dependencies & External Factors

| Dependency | Risk | Mitigation |
|------------|------|-----------|
| Keycloak availability | High | Local testing realm; fallback to basic auth |
| Stripe API changes | Medium | Version pinning, changelog monitoring |
| Kubernetes CAPI adoption | Low | Terraform modules for k8s provisioning |
| Node.js LTS release cycle | Low | Automated Renovate updates + testing |

## References

- **Current Implementation:** See `docs/system-architecture.md`
- **Code Standards:** See `docs/code-standards.md`
- **Deployment Guide:** See `docs/deployment-guide.md`
- **Codebase Map:** See `docs/codebase-summary.md`
- **Project PDR:** See `docs/project-overview-pdr.md`

---

**Questions?** Open an issue or reach out to the maintainers.
