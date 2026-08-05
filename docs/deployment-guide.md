# Deployment Guide

Complete setup instructions for local development, Kubernetes deployment, and CI/CD pipeline.

## Prerequisites

- **Node.js:** ≥ 24.14.0
- **pnpm:** 10.32.1
- **Docker & Docker Compose:** Latest stable
- **Kubectl:** ≥ 1.27 (for Kubernetes deployments only)
- **Git:** Latest stable

Verify installation:
```bash
node --version     # v24.14.0+
pnpm --version     # 10.32.1
docker --version   # Docker 24+
docker compose --version  # Docker Compose 2.20+
```

## Local Development Setup

### 1. Clone & Install

```bash
git clone https://github.com/ndgkhoa/food-delivery-api.git
cd food-delivery-api
pnpm install
cp .env.example .env
```

### 2. Start Infrastructure (Docker Compose)

**Core services** (always needed):
```bash
docker compose --env-file .env -f infra/docker-compose.yml \
  --profile core \
  --profile auth \
  --profile messaging \
  up -d
```

**Optional profiles:**
- `--profile search` — Elasticsearch (search service)
- `--profile media` — MinIO (media service)
- `--profile workflow` — Temporal (payment service)
- `--profile analytics` — ClickHouse (analytics service)
- `--profile notification` — Mailpit (notification service)
- `--profile observability` — Prometheus, Jaeger, Loki, Grafana
- `--profile replica` — Read replica for orders list queries

**Full stack** (recommended first run):
```bash
docker compose --env-file .env -f infra/docker-compose.yml \
  --profile core --profile auth --profile messaging --profile search \
  --profile media --profile workflow --profile analytics --profile notification \
  --profile observability \
  up -d
```

**Verify all services are healthy:**
```bash
docker compose --env-file .env -f infra/docker-compose.yml ps
```

Expected status: all containers `running` or `healthy`.

### 3. Run Database Migrations

```bash
pnpm nx run-many -t migration-run
```

This runs TypeORM migrations in sequence across all services.

### 4. Start All 13 Services

```bash
pnpm dev
```

This starts:
- gateway (:3000)
- auth (:3002)
- catalog (:3001, gRPC :50051)
- search (:3004)
- order (:3003)
- inventory (gRPC :50052 only)
- payment (:3007)
- delivery (:3005)
- media (:3006)
- notification (:3012)
- review (:3009)
- analytics (:3010)
- config (:3008)

**Verify services are running:**
```bash
curl http://localhost:3000/api/v1/reference  # Scalar API docs
```

### 5. Seed Demo Data

```bash
pnpm seed:up
```

Creates:
- 2 tenants (tenant-1, tenant-2)
- 3 restaurants per tenant
- 10 menu items per restaurant
- 2 drivers per tenant
- Sample orders with edge cases (compensation, idempotency retries)

To clean up:
```bash
pnpm seed:down
```

### 6. Access Services

| Service | URL | Credentials |
|---------|-----|-------------|
| **API Gateway** | http://localhost:3000/api/v1 | (requires JWT) |
| **API Reference** | http://localhost:3000/api/v1/reference | — |
| **Keycloak** | http://localhost:8080 | admin/admin |
| **MinIO Console** | http://localhost:9001 | minioadmin/minioadmin |
| **Temporal UI** | http://localhost:8233 | — |
| **Mailpit** | http://localhost:8025 | — |
| **Grafana** | http://localhost:3030 | admin/admin |
| **Jaeger** | http://localhost:16686 | — |
| **Prometheus** | http://localhost:9090 | — |

### 7. Test API Requests

**Option A: Bruno HTTP Collection** (Recommended)
1. Download [Bruno](https://usebruno.com)
2. Import folder: `bruno/` → select `Local` environment
3. Run **Auth › Login** (stores JWT token)
4. Run any other request (token auto-populated)

**Option B: CLI (curl)**
```bash
# Login (get JWT token)
TOKEN=$(curl -s -X POST http://localhost:8080/realms/food-delivery/protocol/openid-connect/token \
  -d "client_id=food-delivery-spa&grant_type=password&username=customer&password=password" \
  | jq -r '.access_token')

# Place order
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "restaurant-1",
    "items": [
      { "menuItemId": "item-1", "quantity": 2 }
    ]
  }'
```

### Troubleshooting Local Setup

| Issue | Solution |
|-------|----------|
| Port conflicts (3000, 5432, etc.) | Change ports in `.env` or kill existing processes |
| Migrations fail | Ensure Postgres is healthy: `docker compose ps` |
| Services won't start | Check logs: `pnpm dev` (shows all service logs in real-time) |
| Kafka messages not processing | Restart Kafka: `docker compose restart kafka` |
| ES index empty | Rebuild: `curl -X POST http://localhost:3000/api/v1/search/rebuild` |
| Redis connection error | Verify Redis is running: `docker compose ps redis` |

## Kubernetes Deployment

### Prerequisites

- Kubernetes cluster (EKS, GKE, k3d, or local kind)
- Kustomize (built into kubectl 1.14+)
- Docker image pushed to registry (see CI/CD section)

### 1. Create Kubernetes Cluster (Local k3d)

```bash
k3d cluster create food-delivery --servers 3 --agents 2
k3d kubeconfig merge food-delivery
```

### 2. Create Namespace & Secrets

```bash
kubectl create namespace food-delivery
kubectl config set-context --current --namespace=food-delivery

# Create image pull secret (if using private registry)
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=$GITHUB_USERNAME \
  --docker-password=$GITHUB_TOKEN \
  --namespace=food-delivery

# Create database credentials secret
kubectl create secret generic db-credentials \
  --from-literal=DB_USERNAME=postgres \
  --from-literal=DB_PASSWORD=secure_password_here \
  --namespace=food-delivery

# Create Keycloak secret
kubectl create secret generic keycloak-credentials \
  --from-literal=KEYCLOAK_ADMIN=admin \
  --from-literal=KEYCLOAK_ADMIN_PASSWORD=secure_password \
  --namespace=food-delivery
```

### 3. Deploy Infrastructure (Postgres, Redis, Kafka, etc.)

```bash
# Deploy via Kustomize (dev overlay)
kubectl apply -k infra/k8s/infra-dev/

# Wait for Postgres to be ready
kubectl wait --for=condition=ready pod -l app=postgres --timeout=120s
```

### 4. Deploy Application (All 13 Services)

**Dev Overlay** (recommended for local/testing):
```bash
kubectl apply -k infra/k8s/overlays/dev/
```

**Prod Overlay** (for production):
```bash
kubectl apply -k infra/k8s/overlays/prod/
```

The overlays apply:
- Dev: 2–3 replicas, no HPA, relaxed resource limits
- Prod: 3–10 replicas, HPA enabled (CPU-based), strict resource requests/limits

### 5. Deploy Observability (Optional)

```bash
kubectl apply -k infra/k8s/observability/
```

Deploys:
- Prometheus (scrapes all services)
- Grafana (dashboards)
- Jaeger (distributed traces)
- otel-collector (trace/metric aggregation)
- Loki (logs)

### 6. Verify Deployment

```bash
# Check all pods are running
kubectl get pods -A

# Check service status
kubectl get services

# Port-forward to access services
kubectl port-forward svc/gateway 3000:3000
kubectl port-forward svc/grafana 3030:3000
kubectl port-forward svc/jaeger 16686:16686

# Access via browser
# API: http://localhost:3000/api/v1/reference
# Grafana: http://localhost:3030
# Jaeger: http://localhost:16686
```

### 7. Scale Services

```bash
# Manual scaling
kubectl scale deployment order --replicas=5

# Check HPA status
kubectl get hpa

# View HPA metrics
kubectl describe hpa order
```

### 8. Rollouts (Canary / Blue-Green)

**Canary Rollout** (10% → 50% → 100% over 10 minutes):
```bash
kubectl apply -f infra/k8s/rollout/canary/order-rollout.yaml
kubectl argo rollouts get rollout order --watch
```

**Blue-Green Rollout** (instant cutover):
```bash
kubectl apply -f infra/k8s/rollout/blue-green/order-rollout.yaml
kubectl argo rollouts get rollout order --watch
```

### Kubernetes Manifests Structure

```
infra/k8s/
├── base/                    # Shared resources
│   ├── gateway/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── kustomization.yaml
│   ├── order/
│   ├── ... (per service)
│   ├── network-policies/    # RBAC + NetworkPolicy
│   └── kustomization.yaml
│
├── overlays/
│   ├── dev/
│   │   ├── kustomization.yaml  # Applies dev patches
│   │   └── patches/
│   └── prod/
│       ├── kustomization.yaml  # Applies prod patches (HPA, resource limits)
│       └── patches/
│
├── infra-dev/
│   ├── postgres/
│   ├── redis/
│   └── kustomization.yaml
│
└── observability/
    ├── prometheus/
    ├── grafana/
    ├── jaeger/
    └── kustomization.yaml
```

**Apply a specific overlay:**
```bash
# Dev (lower replicas, no HPA)
kubectl apply -k infra/k8s/overlays/dev/

# Prod (HPA enabled, resource limits)
kubectl apply -k infra/k8s/overlays/prod/
```

### Kubernetes Best Practices

1. **Resource Requests/Limits:** Set in prod overlay to enable HPA
   ```yaml
   resources:
     requests:
       cpu: 100m
       memory: 128Mi
     limits:
       cpu: 500m
       memory: 512Mi
   ```

2. **Health Checks:** All deployments include readiness + liveness probes
   ```yaml
   readinessProbe:
     httpGet:
       path: /health/ready
       port: 3000
     initialDelaySeconds: 10
   livenessProbe:
     httpGet:
       path: /health/live
       port: 3000
     initialDelaySeconds: 30
   ```

3. **Network Policies:** Restrict traffic to needed flows only
   ```bash
   kubectl apply -f infra/k8s/base/network-policies/
   ```

4. **RBAC:** ServiceAccounts + Roles for least-privilege
   ```bash
   kubectl apply -f infra/k8s/base/internal-identity/
   ```

## CI/CD Pipeline

### GitHub Actions Workflows

Located in `.github/workflows/`:

#### `ci.yml` (on PR + push develop/main)

Runs on every PR and push to `develop` or `main`:

```yaml
name: CI
on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  affected:
    name: Nx affected checks
    steps:
      - Checkout
      - Setup Node & pnpm
      - Install dependencies
      - Cache Nx
      - Derive base (NX_BASE, NX_HEAD)
      - nx affected -t lint test build  # Only affected services
      - Biome format check
      - dependency-cruiser (boundary validation)
      - knip (unused imports)
      - Trivy filesystem scan (advisory; doesn't block)
```

**To debug locally:**
```bash
# Simulate CI
pnpm nx affected -t lint test build --base=main --head=HEAD
pnpm run lint
pnpm run cruiser
pnpm run knip
```

#### `cd.yml` (on push main only)

Continuous Deployment; runs only on push to `main`:

```yaml
name: CD
on:
  push:
    branches: [main]

jobs:
  build-and-push:
    name: Build & Push Image
    steps:
      - Checkout
      - Build single Docker image (bundles all 13 services)
      - Push to GHCR (ghcr.io/ndgkhoa/food-delivery-api)
      - cosign keyless sign image
      - Generate SLSA provenance
      - Trivy image scan (blocking HIGH/CRITICAL)
      - Deploy to k8s (requires GitHub environment approval)
```

**Image tagging:**
- `ghcr.io/ndgkhoa/food-delivery-api:latest` — On push to main
- `ghcr.io/ndgkhoa/food-delivery-api:sha-{commit}` — Commit-specific tag

#### `release-please.yml` (release automation)

Automatically creates release PRs on `main` based on conventional commits:

```yaml
name: release-please
on:
  push:
    branches: [main]

jobs:
  release-please:
    name: Release Please
    steps:
      - release-please creates/updates PR with bumped version
      - On merge, tags release and creates GitHub Release
      - Triggers `cd.yml` to deploy
```

**Version bumping:**
- `feat:` → Minor (1.2.0 → 1.3.0)
- `fix:` → Patch (1.2.0 → 1.2.1)
- `BREAKING CHANGE:` footer → Major (1.2.0 → 2.0.0)

### Local CI Simulation

Test your changes locally before pushing:

```bash
# Run all linting & testing
pnpm run lint
pnpm test
pnpm nx affected -t build
pnpm run cruiser
pnpm run knip

# Verify image builds
docker build -t food-delivery-api:test -f infra/docker/Dockerfile .
```

### Image Signing & Attestation

Images pushed to GHCR are signed with cosign (keyless):

```bash
# Verify image signature
cosign verify ghcr.io/ndgkhoa/food-delivery-api:sha-{commit} \
  --certificate-identity-regexp=https://github.com/ndgkhoa/food-delivery-api \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com

# View SLSA provenance
cosign verify-attestation ghcr.io/ndgkhoa/food-delivery-api:sha-{commit} \
  --type slsaprovenance \
  --certificate-identity-regexp=https://github.com/ndgkhoa/food-delivery-api
```

### Trivy Security Scanning

Two stages:

1. **Filesystem Scan** (CI, advisory)
   ```bash
   trivy fs .
   ```

2. **Image Scan** (CD, blocking)
   ```bash
   trivy image ghcr.io/ndgkhoa/food-delivery-api:sha-{commit}
   ```

Blocks deployment on HIGH or CRITICAL vulnerabilities.

### GitHub Environments

The CD pipeline uses GitHub Environments for deployment approval:

1. Create Environment in repo settings: Settings → Environments → Create
2. Add protection rules (require approval, restrict branches)
3. CD workflow will wait for manual approval before deploying

```yaml
environment:
  name: production
```

## Production Deployment Checklist

Before deploying to production:

- [ ] All tests pass (`pnpm test`)
- [ ] No HIGH/CRITICAL trivy findings
- [ ] Image is signed with cosign
- [ ] SLSA provenance generated
- [ ] Semantic version bumped (release-please)
- [ ] Kubernetes manifests reviewed (resource limits, HPA, node affinity)
- [ ] Secrets rotated (database passwords, API keys, JWT secrets)
- [ ] Monitoring/alerting configured (Prometheus + Grafana)
- [ ] Backup strategy verified (database + object storage)
- [ ] Disaster recovery plan documented
- [ ] Load testing passed (k6 + SLO verification)

## Monitoring & Observability (Production)

### Prometheus

Scrapes all services every 15 seconds. Access via:

```bash
kubectl port-forward svc/prometheus 9090:9090
# http://localhost:9090
```

Key metrics:
- `http_requests_total` — Total HTTP requests per service/status
- `order_saga_duration_seconds` — Order saga execution time (distribution)
- `kafka_consumer_lag` — Consumer lag per topic/group
- `database_connections` — Active connections per service

### Grafana

Pre-built dashboards for monitoring. Access via:

```bash
kubectl port-forward svc/grafana 3030:3000
# http://localhost:3030 (admin/admin)
```

Dashboards:
- **Service Health:** CPU, memory, request rate per service
- **Order Pipeline:** Saga duration, compensation rate, throughput
- **Database:** Connection pool, query latency, slow queries
- **Kafka:** Consumer lag, topic throughput, error rates

### Jaeger Tracing

Distributed traces across all services. Access via:

```bash
kubectl port-forward svc/jaeger 16686:16686
# http://localhost:16686
```

Trace an order end-to-end:
1. Place order (generates trace ID)
2. Search Jaeger by order ID or trace ID
3. View span hierarchy (HTTP → gRPC → Kafka → activity spans)

### Loki Logs

Structured JSON logs aggregated by Loki. Query via Grafana:

```bash
# Example Loki query
{job="order"} | json | status="CONFIRMED"
```

## Troubleshooting Deployments

| Issue | Solution |
|-------|----------|
| Pod stuck in ImagePullBackOff | Check image exists in registry: `docker pull ghcr.io/...` |
| CrashLoopBackOff | Check logs: `kubectl logs pod-name` |
| Database connection errors | Verify secret created: `kubectl get secrets` |
| HPA not scaling | Check metrics available: `kubectl top nodes`, `kubectl top pods` |
| Kafka producer timeout | Verify broker connectivity: `kubectl exec -it kafka-pod -- kafka-broker-api-versions.sh` |
| Elasticsearch empty | Rebuild index: `curl -X POST http://search:3004/api/v1/search/rebuild` |

## Summary

| Environment | Command | Use Case |
|-------------|---------|----------|
| **Local Dev** | `pnpm install && pnpm dev` | Feature development, testing |
| **Docker Compose** | `docker compose up` | CI/CD simulation, demo |
| **Kubernetes (Dev)** | `kubectl apply -k infra/k8s/overlays/dev/` | Testing k8s manifests |
| **Kubernetes (Prod)** | `kubectl apply -k infra/k8s/overlays/prod/` | Production deployment |
| **CI/CD** | GitHub Actions | Automated build, test, deploy |

For more details, see:
- **CI/CD Configuration:** `.github/workflows/ci.yml`, `cd.yml`
- **Kubernetes Manifests:** `infra/k8s/`
- **Docker Build:** `infra/docker/Dockerfile`
- **Environment Config:** `.env.example`
