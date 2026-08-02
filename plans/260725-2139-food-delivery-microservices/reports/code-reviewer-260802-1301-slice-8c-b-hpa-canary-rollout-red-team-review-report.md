# Red-team review — slice 8c-B (HPA + canary/blue-green + graceful shutdown)

Branch `feat/hpa-canary-rollout` (uncommitted). Reviewer: code-reviewer. Date: 2026-08-02.
Scope: graceful shutdown (5 main.ts + base patch), 13 CPU HPAs, custom-metric stack, progressive delivery.

## Verdict
No Critical defects. The live-proven paths (CPU HPA scale, canary split, blue-green cutover, rolling-update drain) hold up. **One High** real failure mode the plan's scale-safety analysis missed: the in-process outbox relay is not replica-safe and the prod overlay scales it unconditionally. One Medium (two HPA objects on `order`). Rest is Low/informational. The documented custom-metric limitation is handled soundly.

---

## HIGH

### H1 — Outbox relay runs N times under HPA; prod `minReplicas:2` guarantees ≥2 concurrent relays
`libs/shared/messaging/src/outbox-relay.ts:12-20` · relay hosts: `apps/order`, `apps/payment`, `apps/review`, `apps/inventory` (each `*-outbox-relay.provider.ts` calls `relay.start()` in `onApplicationBootstrap`, no leader election) · `infra/k8s/base/{order,payment,review,inventory}/hpa.yaml` · `infra/k8s/overlays/prod/kustomization.yaml:75-88` (HPA `minReplicas:2`).

The relay's own contract (outbox-relay.ts:12-20) states it is **at-least-once**, that the `FOR UPDATE SKIP LOCKED` row lock is released when `fetchUnpublished`'s tx commits — *before* publish + `markPublished` — so "two relays can race the publish window", and prescribes: **"run one relay per service to keep re-publishes rare."**

Every relay-hosting service now carries a CPU HPA, and the prod overlay patches every HPA floor to `minReplicas:2`. So in prod there are **always ≥2 relays per service**, and under CPU load up to `maxReplicas` (dev 5 / prod 10). Concrete scenario: relay A fetches rows 1-100, its short claim-tx commits (locks released), then A publishes. Before A's `markPublished` lands, relay B ticks (default 1s), the rows are unlocked and still `published=false`, so `SKIP LOCKED` does not skip them → B re-publishes rows 1-100. Duplicate publishes go from "rare" to routine, scaling with replica count.

Not data corruption — consumers are idempotent (IdempotentConsumer / `processedEvents`), which is the accepted at-least-once contract. But it (a) silently violates an explicit design invariant, (b) multiplies Kafka volume + downstream dedup pressure proportional to replica count, (c) was never considered in the plan's scale-safety note (which analyzed only delivery/RedisIoAdapter and the order saga-reaper). The plan's blanket "all stateless services → HPA, safe to scale" is wrong for these four.

Fix (pick one):
- **Serialize the drain with a lock** (cheapest, no infra): wrap each tick in a Postgres advisory lock (`pg_try_advisory_lock(<service-key>)`) or reuse `libs/shared/locking` (redis-distributed-lock) so only one replica drains per tick; others no-op. Keeps relay co-located with the app and HPA-safe.
- **Split the relay into its own `replicas:1` Deployment** (exclude from HPA) while the HTTP surface scales freely.
- **Accept + document explicitly**: if relying on idempotent consumers, add a note to the HPA/relay that prod runs N relays by design and duplicate-publish rate is O(replicas) — and drop the "run one relay per service" guidance as stale. (Weakest; increases broker load.)

Recommend the advisory-lock option — smallest change, preserves the invariant, no new component.

---

## MEDIUM

### M1 — Two HPA objects target the `order` Deployment (documented anti-pattern, shipped)
`infra/k8s/base/order/hpa.yaml` (HPA `order`, CPU) + `infra/k8s/observability/custom-metric-hpa/order-request-rate-hpa.yaml` (HPA `order-request-rate`, Pods metric) both set `scaleTargetRef → Deployment/order`.

The custom-metric HPA file comment (lines 1-9) correctly names this as an anti-pattern ("two separate HPA objects... fight each other and flap") yet ships exactly that, justified as "demonstrable independently." Today it is **inert** because the custom metric resolves to `[]` (the known label-topology limitation) → that HPA sits `ScalingActive=False` and does not touch replicas, so the proven CPU HPA is unaffected. But this is a latent trap: the moment the documented fix path (a or b) makes the metric resolve, `order` has two controllers reconciling replicas against different targets → thrash. `observability/` is applied standalone (not in the overlays), so `order` only gets both objects when the observability dir is applied against the same cluster — which is the demonstrated setup.

Fix: the production pattern the comment itself cites — a **single** HPA on `order` with two `metrics` entries (CPU + Pods `http_requests_per_second`); k8s scales to the max of both, no fight. If keeping them separate for teaching, point the custom-metric HPA at a throwaway target (or a dedicated `order-canary` Deployment) rather than the live `order`, and add a guard note that the two must never both target `order` once the metric is live.

---

## LOW / INFORMATIONAL

### L1 — Payment Temporal worker drain can exceed the 25s effective grace (safe, but not clean)
`apps/payment/src/infrastructure/temporal/temporal-worker.provider.ts:88-92`: `onModuleDestroy` calls `worker.shutdown()` (no `shutdownGraceTime` set) then `await runPromise`. preStop `sleep 5` + `terminationGracePeriodSeconds:30` leaves ~25s for all `onModuleDestroy` hooks. A charge activity still running at 25s is SIGKILLed mid-flight. This is **not** data loss — Temporal persists workflow history, re-dispatches the activity to another worker, and activities are idempotent (`processedEvents`), which is the whole durable-execution guarantee. Multiple replicas polling `payment-charges` is the correct Temporal pattern (server delivers each task once) — payment is genuinely scale-safe. Optional polish: set `WorkerOptions.shutdownGraceTime` to ~20s so the worker force-cancels in-flight activities before the kubelet SIGKILL, for a deterministic clean stop. Same 25s ceiling applies to any Kafka/HTTP drain — fine for this API's short requests.

### L2 — Blue-green apply has a brief zero-endpoint window (documented, demo-only)
`infra/k8s/rollout/blue-green/service.yaml`: applying the dir overwrites the `gateway` Service selector to `version: blue`, which excludes the base gateway Deployment (no `version` label). Between `kubectl apply -k` and gateway-blue becoming Ready, the Service selects nothing → zero endpoints. The runbook documents this and it is a standalone manual demo (not wired into overlays), so acceptable. Note if ever automated: apply/warm the blue Deployment to Ready before switching the Service, or the demo drops traffic on first apply.

### L3 — Graceful-shutdown wiring is correct
All 13 apps have `enableShutdownHooks()` (verified — none missing), placed after `listen`/`startAllMicroservices` setup and before `app.listen`, matching inventory's 8c-A pattern. `bootstrap().catch(process.exit(1))` is fine: a bootstrap-time throw means hooks were never registered, so there is nothing to flush — exiting is correct, no regression. Base patch is clean: no base deployment pre-defines `lifecycle` or `terminationGracePeriodSeconds`, so the JSON6902 `op: add` at `containers/0` does not clobber anything. preStop `sleep 5` correctly bridges kube-proxy endpoint-removal propagation (readiness periodSeconds is irrelevant to termination). Non-relay services are genuinely scale-safe: notification (shared Kafka consumer group + BullMQ atomic job claim), analytics (independent consumer group, partition-distributed, ClickHouse dedup-on-merge), order saga-reaper (read-only discovery; only side effect is duplicate log lines + a per-instance counter — cosmetic), delivery (RedisIoAdapter), catalog (Debezium CDC, not an in-process relay). auth/config/search/media are stateless.

### L4 — Custom-metric stack: documenting-not-fixing is the right call; both fix paths are correct
For a portfolio piece with the plan explicitly allowing "manifest+rules validated" for the custom metric, shipping a registered-but-empty adapter with a precise root-cause comment is the sound call — do not fix now. Both documented paths are technically correct: (a) collector `k8sattributes` processor + `resource_to_telemetry_conversion: enabled` so `k8s.pod.name`/`k8s.namespace.name` become series labels is the faithful fix for the OTLP-native pipeline (and needs the pod-read RBAC the comment notes); (b) direct per-pod Prometheus scrape (kubernetes_sd stamps namespace/pod) is the standard adapter assumption. Secondary checks all pass: RBAC is least-privilege (read-only get/list/watch on nodes/namespaces/pods/services — the trimmed upstream set, not over-granted; SA `automountServiceAccountToken:false` is correctly re-enabled at pod level so the aggregated API server can auth). No version mismatch: only `v1beta2.custom.metrics.k8s.io` is registered and the HPA uses `autoscaling/v2` type:Pods which the modern HPA controller resolves via content negotiation — live `Available=True` + `[]` confirms the failure is the label topology, not the API version. No port clash with the 8b compose stack: all observability Services are ClusterIP inside k3d, a separate network namespace from docker-compose. securityContext on all three new pods is solid (runAsNonRoot, readOnlyRootFilesystem, drop ALL caps, seccomp RuntimeDefault).

### L5 — prod overlay HPA patch matches correctly
`labelSelector: app.kubernetes.io/part-of=food-delivery` matches all 13 base HPAs (all carry that label); the observability custom-metric HPA is not in the overlay's resources so it is untouched. `minReplicas:2` uniformly is sound for the stateless services and does not introduce a new singleton hazard beyond H1 (which is the relay, not replica count per se).

---

## Answers to the specific hunts
- **order has two HPAs?** Yes — base CPU `order` + observability `order-request-rate`, both target Deployment/order. See M1. Currently inert; latent flap if the custom metric is activated.
- **payment/notification/analytics multi-replica safe?** Yes, all three. Temporal (server-distributed task queue), BullMQ (atomic claim) + Kafka consumer group, independent consumer group + ClickHouse dedup respectively. The real multi-replica break is the **outbox relay** (order/payment/review/inventory), not these — see H1.
- **preStop 5 + grace 30 cover the drain?** Yes for HTTP/short work; the effective 25s post-preStop window truncates only >25s drains (Temporal-safe, see L1).
- **enableShutdownHooks placement / bootstrap().catch?** Correct in all 5 edited files; no double-listen, no early-exit-before-flush regression.
- **blue-green strands base gateway?** Yes, briefly, by design + documented — demo-only, not in overlays. L2.
- **RBAC over-grant / API version mismatch / port clash?** None. L4.

## Unresolved questions
1. H1 fix direction — advisory-lock the relay (recommended), split to a `replicas:1` Deployment, or formally accept O(replicas) duplicate publishes? Needs an owner decision; changes the "one relay per service" doc either way.
2. M1 — keep two HPA objects (guarded) for the teaching demo, or collapse to one HPA with two metrics before the custom metric is ever activated?

---
Status: DONE
Summary: No Critical issues; live-proven paths are sound. One High (outbox relay is not replica-safe; prod min2 runs ≥2 relays per service for order/payment/review/inventory — plan's scale-safety analysis missed it), one Medium (two HPA objects on `order`, inert today, latent flap). Graceful-shutdown wiring, non-relay scale-safety, rollout manifests, RBAC/security, and the documented custom-metric limitation all check out.
Concerns: H1 violates the relay's explicit "one relay per service" invariant by default in prod — recommend an advisory lock before relying on this in a real cluster.
