# Red-Team Review — Slice 8c-A: K8s Manifests + Dockerfiles

Branch `feat/k8s-manifests-dockerfiles` (uncommitted). Reviewer: code-reviewer. Date: 2026-08-02.
Method: empirical — built 7 service bundles and resolved the prod dependency closure to verify
generatePackageJson capture; cross-checked env schemas vs ConfigMaps/Secrets for all 13 services;
read all deployments/overlays/bootstraps.

## Headline
- **1 CRITICAL**: dev overlay flips `NODE_ENV=development`, which requires `pino-pretty` — a devDependency
  that is **absent from the prod runtime image** (empirically 0 occurrences in the prod closure). Every
  service CrashLoops under `kubectl apply -k overlays/dev`. Renders green (kustomize/kubeconform), never
  runtime-tested as-composed.
- **generatePackageJson blindspot audit (the #1 deliverable): CLEAN beyond `pg`.** Empirically, nx captures
  every dynamically-loaded driver — `@grpc/grpc-js`, `@grpc/proto-loader`, `@confluentinc/kafka-javascript`,
  `ioredis`, `@clickhouse/client`, `@elastic/elasticsearch`, `minio`, `sharp`, `nodemailer`, `bullmq`, all
  four `@temporalio/*`. The ONLY miss is `pg`, because it is TypeORM's **optional** peer (nx includes regular
  peers, skips optional ones). The pg fix covers all services. No siblings exist. Details below.

---

## CRITICAL

### C1. Dev overlay `NODE_ENV=development` → `pino-pretty` missing → all 13 services CrashLoopBackOff
- **Where**: `infra/k8s/overlays/dev/kustomization.yaml:23-33` (patch sets `NODE_ENV: "development"`);
  `libs/shared/logging/src/logging.module.ts:30-33` (`transport: NODE_ENV!=='production' ? {target:'pino-pretty'} : undefined`);
  `infra/docker/Dockerfile:81-83` (`npm install --omit=dev` — pino-pretty is a devDependency, `package.json:107`).
- **Evidence (empirical)**: built the catalog bundle, resolved its generated `package.json` with
  `npm install --omit=dev --package-lock-only` → **`pino-pretty` occurrences in prod closure = 0**. It is not a
  transitive prod dep of pino / pino-http / nestjs-pino either.
- **Failure**: dev overlay is the documented primary local path (it alone pulls in `infra-dev` Postgres/Redis).
  With `NODE_ENV=development`, `SharedLoggingModule` tells pino to spawn a `pino-pretty` transport worker; the
  module can't be resolved → logger init throws during `NestFactory.create` / `useLogger` → `bootstrap()` rejects
  → CrashLoopBackOff. Liveness never comes up. Blast radius = all 13 (every app ConfigMap carries the
  `food-delivery.io/config-kind=app-env` label the patch targets).
- **Reconciles the live-verify**: catalog was reported reaching Postgres — impossible under this overlay as
  written (logger dies before `onModuleInit` DB connect). So the live run used **base** config (NODE_ENV=production)
  + infra-dev, NOT `-k overlays/dev`. The overlay renders but was never actually applied end-to-end.
- **Fix (pick one)**:
  1. Simplest — drop `NODE_ENV: "development"` from the dev patch (keep production). Pretty logs are pointless
     for `kubectl logs`; the dev overlay only needs `TELEMETRY_ENABLED=false`.
  2. Decouple pretty-printing from NODE_ENV: gate on a dedicated `LOG_PRETTY` flag (default false), never set in-cluster.
  3. (Not recommended) promote `pino-pretty` to prod deps — bloats every image for a dev-only concern.

---

## HIGH

### H1. Liveness probe transitively gates on every startup dependency → cold-start / blip = CrashLoop
- **Where**: all 13 `infra/k8s/base/*/deployment.yaml` livenessProbe (`initialDelaySeconds:10, periodSeconds:10,
  failureThreshold:3` → ~40s budget); boot design in each `main.ts` + provider lifecycle hooks
  (e.g. `libs/shared/messaging/src/kafka-producer.ts:67` `onModuleInit→connect`, `payment .../temporal-worker.provider.ts:43-51`
  `onApplicationBootstrap→NativeConnection.connect`).
- **Failure**: dependency connections (Postgres, Kafka, Redis, Temporal, ClickHouse, ES) run in
  `onModuleInit`/`onApplicationBootstrap`, which fire inside `app.listen()`/`init()` **before** the HTTP health
  port binds. If any dep is slow/unreachable at boot, `listen()` rejects → process exits → **both** liveness and
  readiness fail identically. There is no `startupProbe`, so on a whole-namespace cold start (apps + infra racing)
  pods CrashLoopBackOff repeatedly; the exponential backoff (10s→20s→…→5m) can exceed the dep's recovery window,
  slowing convergence, and a transient runtime dep blip kills otherwise-healthy pods. This is exactly the
  documented "catalog blocked on Kafka" behavior, generalized to every service.
- **Fix**: add a `startupProbe` (e.g. `failureThreshold:30, periodSeconds:10` = 5 min) hitting `/api/v1/health`;
  keep liveness lenient (or only for genuine hangs). Optionally bind the health server before dependency
  connects. Liveness should never gate on downstream readiness.

---

## MEDIUM

### M1. `pg` Dockerfile pin can drift from the lockfile
- **Where**: `infra/docker/Dockerfile:81-83` installs `pg@8.22.0`; root declares `pg@^8.22.0`.
- The fix itself is **correct** (pg is TypeORM's optional peer, invisible to webpack — see audit). But hard-pinning
  in the Dockerfile means a future `^8.22.0` lockfile bump silently diverges from what dev/CI resolve. Prefer
  reading the resolved version from `pnpm-lock.yaml` at build time, or add a CI check that the pin matches the lock.
  Low-ish, but it's the one place the driver version lives outside the lockfile.

### M2. `inventory` bootstrap has no `enableShutdownHooks()` (nor `.catch()`) → no graceful drain on SIGTERM
- **Where**: `apps/inventory/src/main.ts:23-52`. Fleet-wide: catalog/order also lack it (0); only `notification`
  (this slice) calls it.
- **Failure**: under k8s rolling updates/scale-down, SIGTERM won't run `onModuleDestroy` (Kafka flush/disconnect,
  Redis lock release, TypeORM pool close, gRPC drain). In-flight gRPC calls and unflushed Kafka messages are
  dropped on every rollout. The conversion was the moment to add it (notification got it; inventory — which now
  owns Kafka+Redis+TypeORM+gRPC — did not). Also `bootstrap();` lacks a `.catch()` (notification has one) so a
  bind failure logs nothing before exit.
- **Fix**: add `app.enableShutdownHooks()` before `listen()` in inventory (and, ideally, fleet-wide);
  wrap `bootstrap().catch(err => { Logger.error(...); process.exit(1); })`.

### M3. prod overlay applies `replicas:2` uniformly — unsafe for singleton background workers
- **Where**: `infra/k8s/overlays/prod/kustomization.yaml` patch (`replicas:2` for every `part-of=food-delivery`
  Deployment).
- **Concerns to verify per service**:
  - `order` saga-reaper uses a plain `setInterval` (`apps/order/src/interface/messaging/saga-reaper.provider.ts:45`),
    so **both** replicas scan for timed-out sagas concurrently. Safe only if the reaper's claim query uses
    `FOR UPDATE SKIP LOCKED` / advisory lock or the compensation is idempotent — otherwise double-compensation.
  - `gateway` uses socket.io but the bundle does **not** include `@socket.io/redis-adapter` (verified absent from
    the gateway manifest) → WS broadcasts/sessions are not shared across the 2 gateway replicas.
  - payment Temporal workers on the same task queue = fine (Temporal arbitrates). Kafka consumers (notification,
    search, review, analytics) with 2 replicas = fine (consumer-group rebalance).
- **Fix**: gate singleton jobs behind leader election or DB-level locking before scaling >1; add the redis adapter
  for gateway WS if multi-replica WS is intended. (Prod overlay is placeholder per 8d, but the uniform patch will
  bite when it goes live.)

### M4. payment Temporal worker under `readOnlyRootFilesystem` — untested
- **Where**: `apps/payment/src/infrastructure/temporal/temporal-worker.provider.ts:53-69` (`Worker.create` +
  `workflowsPath`); Dockerfile copies raw workflow source to `/app/workflows` and sets `TEMPORAL_WORKFLOWS_PATH`.
- **Good**: workflow imports are self-contained (`charge-workflow.ts` imports only `@temporalio/workflow` +
  `./charge-workflow.types`), so runtime bundling resolves under `/app/node_modules`. Native `@temporalio/core-bridge`
  is a regular dep (glibc/slim binary) and is captured.
- **Risk**: `Worker.create` bundles the TS workflows at boot (webpack in-worker). Verify the bundler needs no
  writable path beyond `/tmp` (the only writable mount) under `readOnlyRootFilesystem:true`. Payment was never
  live-verified. Recommend a one-shot `docker run` of the payment image against a local Temporal to confirm boot.

---

## LOW / Informational

- **L1** payment image ships test source: `apps/payment/src/workflows/charge-workflow.spec.ts` is copied raw into
  `/app/workflows` (the `COPY --from=builder .../workflows/` is unfiltered; `.dockerignore` excludes `*-e2e`/`*.md`
  but not `*.spec.ts`). Not loaded (index.ts is the entry) but pollutes the image and the Temporal bundle dir.
- **L2** `analytics-secret` has an empty `CLICKHOUSE_PASSWORD:` value. Works (schema `z.string().default('')`),
  but an empty Secret value is easy to misread as a mistake — add a comment or a placeholder.
- **L3** Placeholder Secrets are committed to git (all clearly `changeme-dev-only`/`postgres`/`minioadmin`). The
  header comment documents intent; acceptable for a learning repo, but SealedSecrets/SOPS or a `.example` pattern
  would be the production-grade move.
- **L4** `inventory` `bootstrap();` unhandled-rejection (folded into M2).

---

## generatePackageJson Blindspot Audit — full 13-service result (KEY DELIVERABLE)

Built prod bundles and inspected the generated manifest for each service. Rule confirmed empirically:
**nx generatePackageJson includes an external package's regular deps and regular peerDependencies, but SKIPS
optional peerDependencies.** So the only runtime crash surface is an *optional* peer loaded via dynamic require.

| Service | Driver(s) needing runtime resolution | In generated manifest? | Verdict |
|---|---|---|---|
| catalog, order, payment, review, config, auth, media, notification, inventory | `typeorm` + **`pg`** (optional peer, dynamic `require`) | typeorm ✅ / **pg ❌** | **pg was the bug** — fixed universally in Dockerfile. Safe now. |
| inventory, catalog (gRPC server); order (gRPC client) | `@grpc/grpc-js`, `@grpc/proto-loader` (Nest `loadPackage`, dynamic) | **both ✅** | Safe — captured (regular peers of @nestjs/microservices). Verified in inventory manifest. |
| catalog, order, payment, search, review, config, analytics, notification, delivery, inventory | `@confluentinc/kafka-javascript` (native, KafkaJS) | ✅ | Safe — statically imported in `kafka-client.ts`; native binary loads on slim/glibc (proven by catalog reaching Kafka). |
| gateway, catalog, media, delivery, notification, inventory | `ioredis` / `bullmq` | ✅ | Safe. |
| analytics | `@clickhouse/client` | ✅ | Safe (pure JS). |
| search | `@elastic/elasticsearch` | ✅ | Safe. |
| media | `minio`, **`sharp`** (native, optional platform pkgs) | ✅ | Safe — sharp captured; its native binary is an *optionalDependency* (not peer), so `npm install` (no `--omit=optional`) pulls `@img/sharp-linux-*` for the runtime-stage arch. |
| payment | `@temporalio/{worker,client,activity,workflow}` (+ native `core-bridge`) | ✅ | Captured; see M4 for readOnlyRootFs caveat. |
| notification | `nodemailer` | ✅ | Safe. |
| gateway | `jose`, `opossum` | ✅ | Safe. |
| all | `pino-pretty` (only if NODE_ENV≠production) | ❌ (devDep) | **This is C1** — not a driver miss but the same "missing at runtime" class. |

Net: the pg fix is correct and sufficient; there is **no second pg-style incident hiding** in the other 12.

---

## Bootstrap Conversions — verdict

- **inventory** (gRPC-only → hybrid HTTP+gRPC): correct. `startAllMicroservices()` before `listen()` is the right
  order; `inheritAppConfig:true` is harmless (no global pipes/filters set in main). gRPC still binds
  `0.0.0.0:50052`; HTTP health on 3011. Ports match deployment/service. Gap: missing `enableShutdownHooks` (M2).
- **notification** (`createApplicationContext` → `NestFactory.create`): correct. `onApplicationBootstrap` Kafka
  consumer + BullMQ workers still fire under `app.listen()`/init; `enableShutdownHooks()` preserved; `.catch()`
  preserved. The added `correlationIdMiddleware` is a no-op given no business HTTP routes — harmless.
- PORT defaults 3011/3012 do not collide with any service (gateway 3000 … analytics 3010, inventory 3011,
  notification 3012; gRPC 50051/50052). Clean.

## Validated Fixes (as requested)
- **infra-dev Postgres** (`infra/k8s/infra-dev/postgres/deployment.yaml`): sound. `fsGroup:999` matches the
  official image's postgres gid; `PGDATA=/var/lib/postgresql/data/pgdata` under the PVC subPath lands data on the
  volume; no cap-drop / no `runAsNonRoot`, so the entrypoint keeps CHOWN/SETUID to initdb then drops to postgres.
  `Recreate` strategy is correct for a single-writer PVC. Good.
- **pg fix**: correct (see audit). Only caveat is the pin drift (M1).
- **builder git/lefthook**: `git init -q .` + installing `git` to satisfy the root `prepare`→`lefthook install`
  is a reasonable, self-contained workaround; the throwaway repo never leaves the builder layer.

## Positive Observations
- securityContext is exemplary and 100% consistent across all 13: `runAsNonRoot`, uid/gid 1000, `fsGroup`,
  `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation:false`, `readOnlyRootFilesystem:true`,
  `capabilities.drop:[ALL]`, `/tmp` emptyDir for the one writable path. readOnlyRootFs is compatible (pino→stdout,
  sharp→memory, Temporal→/tmp).
- Non-DB services (analytics/search/gateway/delivery) correctly `.omit` the DB_* block from the base schema, so
  the manifests legitimately omit DB vars — no false "required var missing" crash.
- Env completeness verified for all 13: every required (no-default) var is provided (DB_* via Secret, service
  URLs/brokers via ConfigMap). No boot-crashing gaps found.
- Overlays patch cleanly (labelSelector one-shots, no manifest duplication); prod overlay references no in-cluster
  infra and swaps image refs correctly. Secrets are `Secret` not `ConfigMap`; no real credentials.

## Unresolved Questions
1. Was `kubectl apply -k overlays/dev` ever actually applied (vs `kustomize` render)? C1 predicts it crashes as
   written — please re-run and confirm the fix.
2. Does the order saga-reaper claim query use row locking / idempotency? Determines whether prod `replicas:2` is
   safe for order (M3).
3. Does the Temporal runtime workflow bundler write only to `/tmp` under readOnlyRootFs? (M4 — needs a payment
   container smoke test.)
