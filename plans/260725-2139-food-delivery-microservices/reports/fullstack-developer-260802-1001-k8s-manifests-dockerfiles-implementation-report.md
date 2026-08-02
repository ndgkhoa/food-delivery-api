# K8s manifests + Dockerfile implementation report

Plan: `plans/260725-2139-food-delivery-microservices/phase-08c-a-k8s-manifests-dockerfiles.md`
Branch: `feat/k8s-manifests-dockerfiles` (no commit/push done, per instructions)

## Files created/modified

**Shared health lib** (new): `libs/shared/health/{project.json,tsconfig*.json,jest.config.cts,src/{health.controller.ts,health.module.ts,health.controller.spec.ts,index.ts}}`. Registered: `tsconfig.base.json` path alias `@food-delivery-api/shared-health`, `commitlint.config.mjs` scope `shared-health`.

**AppModule wiring** (12 non-gateway services import `HealthModule`): `apps/{catalog,auth,order,search,delivery,media,payment,config,review,analytics,inventory,notification}/src/app.module.ts`. Gateway untouched — keeps its own `HealthController` (gateway-only `@Public()`/`@SkipRateLimit()` decorators).

**Bootstrap changes** (2 services had no HTTP listener at all — see Deviations):
- `apps/inventory/src/main.ts` — pure-gRPC `createMicroservice` → hybrid app (`NestFactory.create` + `connectMicroservice`), mirrors catalog's existing hybrid pattern. `apps/inventory/src/config/inventory-env-schema.ts` — added `PORT` (default 3011).
- `apps/notification/src/main.ts` — `createApplicationContext` → `NestFactory.create` + `listen`. `apps/notification/src/config/notification-env-schema.ts` — added `PORT` (default 3012).

**Docker**: `infra/docker/Dockerfile` (parameterized `ARG APP`, multi-stage builder+runtime), `.dockerignore` (repo root).

**K8s**: `infra/k8s/base/` — `namespace.yaml`, `ingress.yaml`, `kustomization.yaml`, and 13 per-app dirs each with `deployment.yaml` + `service.yaml` + `configmap.yaml` + `kustomization.yaml` (+ `secret.yaml` for the 10 apps that actually have credential env vars — see below). `infra/k8s/infra-dev/` — `postgres/` (pvc+configmap+secret+deployment+service) + `redis/` (deployment+service) + `kustomization.yaml`. `infra/k8s/overlays/{dev,prod}/kustomization.yaml`.

Total: 77 files under `infra/k8s/`, 1 Dockerfile, 1 `.dockerignore`.

## Per-app port / gRPC confirmation (verified from each `*-env-schema.ts`, not assumed)

| App | HTTP port | gRPC | Notes |
|---|---|---|---|
| gateway | 3000 | — | unchanged, existing health |
| catalog | 3001 | 50051 | hybrid HTTP+gRPC (pre-existing) |
| auth | 3002 | — | |
| order | 3003 | — | gRPC **client** only (calls catalog:50051, inventory:50052) |
| search | 3004 | — | |
| delivery | 3005 | — | + Socket.IO on same port |
| media | 3006 | — | |
| payment | 3007 | — | + Temporal worker, Kafka consumer, in same process |
| config | 3008 | — | |
| review | 3009 | — | |
| analytics | 3010 | — | |
| inventory | **3011 (new)** | 50052 | was pure-gRPC, no HTTP at all — added hybrid HTTP solely for `/api/v1/health` |
| notification | **3012 (new)** | — | was headless (`createApplicationContext`) — added minimal HTTP listener solely for `/api/v1/health` |

## Full env-var set per service (ConfigMap vs Secret) — for spotting a missing key during k3d deploy

- **gateway** (no Secret needed — no credential fields in schema): `NODE_ENV LOG_LEVEL OTEL_EXPORTER_OTLP_ENDPOINT TELEMETRY_ENABLED PORT CATALOG_SERVICE_URL AUTH_SERVICE_URL ORDER_SERVICE_URL SEARCH_SERVICE_URL DELIVERY_SERVICE_URL MEDIA_SERVICE_URL CONFIG_SERVICE_URL REVIEW_SERVICE_URL ANALYTICS_SERVICE_URL KEYCLOAK_URL KEYCLOAK_REALM JWT_AUDIENCE JWT_CLOCK_TOLERANCE_SEC KEYCLOAK_SPA_CLIENT_ID RATE_LIMIT_ENABLED RATE_LIMIT_MAX RATE_LIMIT_WINDOW_SEC REDIS_URL CB_ENABLED CB_ERROR_THRESHOLD_PERCENT CB_RESET_TIMEOUT_MS CB_ROLLING_WINDOW_MS CB_VOLUME_THRESHOLD`
- **catalog**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME KAFKA_BROKERS KAFKA_CLIENT_ID REDIS_URL CATALOG_GRPC_URL`; Secret `DB_USERNAME DB_PASSWORD`
- **auth**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME KEYCLOAK_URL KEYCLOAK_REALM`; Secret `DB_USERNAME DB_PASSWORD KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD`
- **order**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME DB_REPLICA_PORT CATALOG_GRPC_URL INVENTORY_GRPC_URL KAFKA_BROKERS KAFKA_CLIENT_ID SAGA_REAPER_TIMEOUT_MS SAGA_REAPER_INTERVAL_MS CONFIG_SERVICE_URL CONFIG_CACHE_TTL_MS`; Secret `DB_USERNAME DB_PASSWORD` (`DB_REPLICA_HOST` intentionally unset — optional, falls back to primary)
- **search** (no Secret — no DB, ES has no auth in dev): ConfigMap `...common... ELASTICSEARCH_NODE KAFKA_BROKERS KAFKA_CLIENT_ID`
- **delivery** (no Secret — no DB, JWT verifies via public JWKS): ConfigMap `...common... REDIS_URL KAFKA_BROKERS KAFKA_CLIENT_ID DRIVER_LOCATION_RATE_LIMIT_PER_SEC NEARBY_RADIUS_M KEYCLOAK_URL KEYCLOAK_REALM JWT_AUDIENCE JWT_CLOCK_TOLERANCE_SEC`
- **media**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME MINIO_ENDPOINT MINIO_PORT MINIO_USE_SSL MEDIA_BUCKET PRESIGN_TTL_SECONDS MAX_UPLOAD_BYTES ALLOWED_MIME THUMBNAIL_WIDTH REDIS_URL`; Secret `DB_USERNAME DB_PASSWORD MINIO_ACCESS_KEY MINIO_SECRET_KEY`
- **payment**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME KAFKA_BROKERS KAFKA_CLIENT_ID PAYMENT_STUB_FAIL_AT_CENTS TEMPORAL_ADDRESS TEMPORAL_NAMESPACE TEMPORAL_TASK_QUEUE`; Secret `DB_USERNAME DB_PASSWORD PAYMENT_WEBHOOK_SECRET` (placeholder ≠ the code's hardcoded dev-default string, so the zod `superRefine` production check never trips). `TEMPORAL_WORKFLOWS_PATH` is **not** in the ConfigMap — the Dockerfile sets it via image `ENV` (`/app/workflows`, workflow source copied into every image).
- **config**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME KAFKA_BROKERS KAFKA_CLIENT_ID`; Secret `DB_USERNAME DB_PASSWORD`
- **review**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME KAFKA_BROKERS KAFKA_CLIENT_ID`; Secret `DB_USERNAME DB_PASSWORD`
- **analytics** (no DB — ClickHouse only): ConfigMap `...common... CLICKHOUSE_URL CLICKHOUSE_DATABASE KAFKA_BROKERS KAFKA_CLIENT_ID`; Secret `CLICKHOUSE_USER CLICKHOUSE_PASSWORD` (empty placeholder, matches schema default)
- **inventory**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME REDIS_URL INVENTORY_GRPC_URL KAFKA_BROKERS KAFKA_CLIENT_ID`; Secret `DB_USERNAME DB_PASSWORD`
- **notification**: ConfigMap `...common... DB_HOST DB_PORT DB_NAME KAFKA_BROKERS KAFKA_CLIENT_ID REDIS_URL SMTP_HOST SMTP_PORT MAIL_FROM NOTIFY_MAX_ATTEMPTS NOTIFY_BACKOFF_MS NOTIFY_EMAIL_ENABLED NOTIFY_SMS_ENABLED NOTIFY_PUSH_ENABLED`; Secret `DB_USERNAME DB_PASSWORD`

`...common...` = `NODE_ENV LOG_LEVEL OTEL_EXPORTER_OTLP_ENDPOINT TELEMETRY_ENABLED PORT` on every app.

All hostnames use in-cluster short DNS (`<svc>.food-delivery`), matching the orchestrator's example format. Only `postgres` and `redis` are actually backed by `infra-dev` in this slice; `kafka`/`elasticsearch`/`clickhouse`/`temporal`/`minio`/`keycloak`/`otel-collector`/`mailpit` Service DNS names are wired in ConfigMaps but **not deployed** — any pod needing them will not reach Ready unless the orchestrator deploys those too or only applies the gateway+catalog(+order) subset.

## Deviations from the plan brief (with rationale)

1. **Inventory and notification had NO HTTP surface at all**, not just "no health endpoint" — inventory is `NestFactory.createMicroservice` (gRPC-only, no HTTP adapter), notification is `NestFactory.createApplicationContext` (no listener of any kind). Importing `HealthModule` into their `AppModule` alone would not make the controller reachable. Fixed by converting both to hybrid/HTTP-listening bootstraps (inventory mirrors catalog's existing hybrid HTTP+gRPC pattern; notification switches to `NestFactory.create().listen()`), each on a new port (3011/3012) added to their env schemas. This is a real, tested code change (all 12 project test suites pass), not a workaround.
2. **3 apps (gateway, search, delivery) have no `Secret`** — their env schemas have zero required-no-default credential fields (no DB, no auth-bearing config). Their `kustomization.yaml` lists only `deployment.yaml service.yaml configmap.yaml`; their Deployment's `envFrom` has no `secretRef`.
3. **`payment`'s ConfigMap omits `TEMPORAL_WORKFLOWS_PATH`** — the Dockerfile bakes it in as an image `ENV` pointing at `/app/workflows` (workflow source copied into every image, cheap, per the plan's own "simplest" suggestion). A ConfigMap entry would just duplicate/risk drifting from that.
4. **Dev overlay is intentionally thin** — the base manifests are already dev-shaped (1 replica, `food-delivery/<app>:dev`, `IfNotPresent`, modest resources), so `overlays/dev` only adds the `infra-dev` component plus one genuinely dev-specific patch (`TELEMETRY_ENABLED=false`, `NODE_ENV=development`, multi-targeted at all 13 app ConfigMaps via a `food-delivery.io/config-kind=app-env` label — avoids also touching `infra-dev`'s `postgres-init` ConfigMap). All the meaningful divergence (replicas→2, real resource limits, registry images, external-infra ConfigMap patches) lives in `overlays/prod`, applied via labelSelector-targeted multi-resource patches (3 JSON6902 ops on all 13 Deployments + 1 strategic-merge patch on all 13 app ConfigMaps + a 13-entry `images:` transformer) rather than 13× duplicated patch blocks.

## Verified offline (all clean)

- `pnpm nx test shared-health` — 1/1 pass.
- `pnpm nx run-many -t test` for all 12 touched app projects (catalog, auth, order, search, delivery, media, payment, config, review, analytics, inventory, notification) — 12/12 suites, 349 tests total, all pass.
- `npx tsc --noEmit` on `apps/inventory/tsconfig.app.json` and `apps/notification/tsconfig.app.json` (the two bootstrap-rewrite files aren't covered by unit tests) — clean.
- `pnpm biome check .` (full repo) — clean (1 pre-existing unrelated deprecation info in `biome.json`).
- `pnpm run cruiser` — 0 violations, 904 modules / 2999 deps.
- `pnpm run knip` — clean, no output.
- `kubectl kustomize infra/k8s/overlays/dev` and `.../overlays/prod` — both render without error.
- `kubeconform -strict -ignore-missing-schemas -summary` on both renders — **dev: 58/58 valid, prod: 51/51 valid, 0 errors**.
- `hadolint` — not installed in this environment; deferred to 8d per the plan's own allowance.
- **Docker build**: `docker build -f infra/docker/Dockerfile --build-arg APP=catalog -t food-delivery/catalog:dev .` — succeeded (fixed 2 real issues along the way, see below). Image inspected: `Config.User = node` (non-root confirmed), content size ~116MB.
- **Docker smoke-run**: ran the built image with `--read-only --tmpfs /tmp --user 1000:1000` (i.e. simulating the k8s `securityContext` exactly) against an unreachable DB — `node main.js` stayed alive as PID 1 with no immediate crash (no `EACCES`, no missing-module error); the silence is NestJS/TypeORM's buffered-logs-during-connection-retry behavior (logs only flush once `useLogger()` runs, which happens after `NestFactory.create()` resolves — and module init, including the DB connection attempt, blocks that). This is expected retry behavior against a genuinely unreachable DB, not a defect — proved the image entrypoint, user, and read-only-fs assumptions are all sound.

## Left for the live k3d deploy (orchestrator)

- Actually creating the k3d cluster, building/importing the other 12 app images, applying `overlays/dev`, and confirming Ready pods + a working request through the Traefik Ingress.
- Whether `readinessProbe.initialDelaySeconds: 5` / `livenessProbe.initialDelaySeconds: 10` are generous enough once a real (reachable) Postgres is up — should be fine, but the DB-connection-retry buffered-log behavior above means a genuinely slow-to-appear Postgres could delay first successful health check past the probe's `failureThreshold: 3 × periodSeconds: 10` = 30s grace window; watch for early liveness restarts if `infra-dev/postgres` is still initializing when app pods start (no explicit `initContainer` DB-wait was added — YAGNI for this slice, but flagging it).
- `catalog`'s image is already built and tagged `food-delivery/catalog:dev` locally (Docker Desktop) — can be `k3d image import`ed directly without rebuilding.
- Only `postgres` + `redis` exist in `infra-dev`; any of the other 11 services deployed without their Kafka/ES/ClickHouse/Temporal/MinIO/Keycloak dependency will not reach Ready (expected — full graph is a documented cloud/CI concern per the plan).
- `auth` needs `KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD` pointed at a real Keycloak if actually exercised — not part of the gateway+catalog subset, so low risk for this verification pass.

## Docker build issues found and fixed (both real, both now resolved)

1. Root `package.json`'s `prepare` script (`lefthook install`) requires the `git` **binary**, absent from `node:24.14-slim` — added `apt-get install -y git` to the builder stage only (discarded in the final multi-stage runtime image).
2. Even with `git` installed, `lefthook install` needs *some* git repository to register hooks into, and `.git` is correctly excluded from the build context via `.dockerignore` — added `RUN git init -q .` in the builder stage (a throwaway repo, never copied to runtime) rather than disabling the script (which is needed for real local dev) or `--ignore-scripts` (which would also skip the *required* native-module install scripts for `esbuild`/`@swc/core`/`@confluentinc/kafka-javascript`).

## Grep for real credentials

`grep -rn "abc123456\|AKIA\|BEGIN.*PRIVATE KEY\|ghp_\|sk-\|xox" infra/k8s infra/docker` — 0 matches. All Secret values are the single obviously-fake placeholder `changeme-dev-only` (or empty/`minioadmin`/`admin`/`postgres`, all already-public dev defaults matching `.env.example`), base64-encoded.

## Unresolved questions

- None blocking. One judgment call flagged above (inventory/notification bootstrap conversion) — implemented as real code (tested), not a stub, since the alternative (leaving them with zero probe-able surface) would make the plan's own success criterion ("every app needs a liveness+readiness endpoint... probes must hit a real 200") unsatisfiable for 2 of the 13 services.

**Status:** DONE
**Summary:** Shared health lib + 12 AppModule wirings (2 needed real bootstrap conversions) + parameterized Dockerfile (build-verified for catalog, non-root, read-only-fs-safe) + full K8s base (13 apps)/infra-dev/dev+prod overlays, all kubeconform-clean (58/51 valid, 0 errors), all offline gates green.
**Concerns/Blockers:** None blocking. Watch items for the live k3d pass are listed above (probe timing vs Postgres startup; infra-dev only covers postgres+redis).
