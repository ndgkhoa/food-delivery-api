# Code Review — k8s NetworkPolicy set (`feat/k8s-network-policies`)

Scope: `infra/k8s/base/network-policies/**` (21 policies, 11 files) + `infra/k8s/base/kustomization.yaml` (+1) + `infra/k8s/overlays/prod/kustomization.yaml` (+10). Uncommitted.
Cross-checked against: all 13 base deployments + configmaps, `infra/k8s/infra-dev/**`, `infra/k8s/observability/**`, dev/prod overlays.
Verdict: **Dev topology correct. Prod topology has a namespace-egress outage (Critical).** Enforcement itself already verified on k3d — findings are about rule completeness vs real topology.

---

## CRITICAL

### C1 — Prod default-deny egress blocks ALL external managed infra (total prod outage)
Files: `02-allow-egress-within-namespace.yaml`, `03-allow-otlp-egress-to-observability.yaml`, `00-default-deny-all.yaml:15-18` + `infra/k8s/overlays/prod/kustomization.yaml` external-infra patch (`data:` block, `DB_HOST`/`REDIS_URL`/`KAFKA_BROKERS`/`TEMPORAL_ADDRESS`/`KEYCLOAK_URL`/`ELASTICSEARCH_NODE`/`CLICKHOUSE_URL`/`MINIO_ENDPOINT`/`SMTP_HOST`).

The egress model is namespace-confined:
- `00` denies all egress; `01` allows only DNS→kube-system:53; `02` allows only in-namespace pods (`to: [podSelector: {}]`, no namespaceSelector = same ns); `03` allows only observability ns:4317/4318.

That is complete for DEV, where every dependency is in-ns (`infra-dev` = postgres+redis in `food-delivery`, telemetry off). It is **not** complete for PROD: the prod overlay repoints every datastore/broker/auth to **external** hostnames (`prod-postgres.internal.example.com:5432`, `prod-redis…:6379`, `prod-kafka…:9092`, `prod-temporal…:7233`, `https://auth.example.com`, ES/ClickHouse/MinIO/SMTP). These resolve (DNS is allowed) to IPs **outside** the pod/service CIDR — not pods, not observability ns — so `02`/`03` never match them and `default-deny` drops every connection.

Scenario: apply prod overlay → every pod boots, DNS resolves `prod-postgres…`, TCP SYN to the external IP:5432 is dropped by the CNI. Nest `onModuleInit` DB/Redis/Kafka/Temporal connects hang/fail → readiness never passes → whole app is down. Same for Keycloak token validation (401s) and OTLP if it pointed anywhere external.

Fix: the prod overlay must ship an egress `NetworkPolicy` (or patch) allowing the external infra. NetworkPolicy can't match external hostnames, so use `ipBlock` CIDRs + ports for the managed endpoints, e.g.:
```yaml
egress:
  - to: [{ ipBlock: { cidr: <managed-infra-cidr> } }]
    ports: [{protocol: TCP, port: 5432},{...6379},{...9092},{...7233},{...443}]
```
Add it in the prod overlay (not base — dev doesn't need it). Until then, prod = default-deny egress outage. The prod overlay's NetworkPolicy note documents CNI enforcement but is silent on this — it is inaccurate/incomplete for its own external-infra design.

---

## MEDIUM

### M1 — kubelet probes rely on CNI host-traffic exemption (verify before prod)
All 13 deployments use `httpGet` liveness/readiness probes, and the base kustomization patch adds an `httpGet` `startupProbe` to every Deployment (`infra/k8s/base/kustomization.yaml` patch block). Probes originate from the node, not a pod; `default-deny` ingress + pod-selector allow-lists do not whitelist the node IP.

Assessment: NOT an outage on the verified stack. k3s/kube-router applies pod policy on forwarded pod↔pod traffic, not node→local-pod, so probes pass — implicitly proven, since the k3d enforcement test required `order` and `catalog` pods to reach Ready under `default-deny`. Mainstream managed CNIs (Calico without HostEndpoints, Cilium without host firewall) likewise exempt node→pod by default. Real risk only if the prod CNI enables host-firewall/HostEndpoints, which would break all probes → CrashLoop everything.

Fix: add one line to the prod overlay CNI note: "verify pod probes stay green under default-deny on the target CNI (host-firewall/HostEndpoints disabled, or add a health-port ingress allow)." No manifest change needed for k3s.

### M2 — `ingress-keycloak` omits `delivery` (and any other JWKS client)
`ingress-infra.yaml:108-132` allows keycloak:8080 from `gateway` + `auth` only. But `delivery/configmap.yaml` also sets `KEYCLOAK_URL: http://keycloak.food-delivery:8080` — delivery is a keycloak client and is not whitelisted. Latent today (keycloak has no in-ns Deployment in dev; external+egress-blocked in prod per C1), so it bites only once keycloak is deployed in-ns. Fix: add a `delivery` (and audit for other JWKS validators) `from` entry, or scope keycloak ingress to `part-of: food-delivery` like the other infra.

---

## LOW / INFORMATIONAL

### L1 — `ingress-temporal` allows `order`, which has no Temporal client config
`ingress-infra.yaml:96-106` whitelists `payment` + `order`. Only `payment/configmap.yaml` sets `TEMPORAL_ADDRESS`; order has none. Harmless over-permission (temporal not in-ns), but the allow-list overstates the real client set. Trim `order` or confirm it will become a Temporal client.

### L2 — Base configmaps point OTLP at a non-existent in-ns Service
All 13 `*/configmap.yaml` set `OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector.food-delivery:4318`, but the collector Service lives in the `observability` ns (`otel-collector.observability`). Not triggered on shipped overlays (dev sets `TELEMETRY_ENABLED=false`; prod patches the endpoint to `otel-collector.observability:4318`, which `03` correctly permits). So `03` is right; the base value is a latent inconsistency that would silently break telemetry if base is applied directly with telemetry on. Fix base value to `otel-collector.observability:4318` for consistency.

### L3 — DB/cache/broker ingress uses broad `part-of: food-delivery` from-selector
`ingress-infra.yaml` postgres/redis/kafka and `ingress-config.yaml` allow any `part-of: food-delivery` pod. Combined with the coarse `02` egress, datastore microsegmentation is effectively "every app pod can reach every datastore" — a compromised non-owning service (e.g. media) can open postgres/redis/kafka directly. This is the stated coarse model, acceptable for the project, but note the residual blast radius. Per-datastore owner selectors would tighten it if desired (YAGNI otherwise).

### L4 — `ingress-config.yaml:22-27` gateway `from` entry is redundant
`part-of: food-delivery` already covers the gateway pod; the explicit `gateway` entry is documentation-only. Cosmetic.

### L5 — Observability stack not in dev/prod overlay `resources`
`infra/k8s/observability` (its own `namespace.yaml` + collector) is not listed under either overlay's `resources`; prod OTEL endpoint + `03` carve-out both reference a collector no deployed overlay includes. Likely applied as a separate kustomize root — confirm the apply order so `03` isn't permanently inert in prod. (Unresolved Q.)

---

## Verified correct (positive observations)

- gRPC restriction is tight: `ingress-grpc.yaml` — catalog:50051 and inventory:50052 accept `from` `order` ONLY, no wildcard, no gateway. Matches the H2 backstop intent.
- All ingress ports are numeric and match container ports exactly: gateway 3000, catalog 3001/50051, auth 3002, order 3003, search 3004, delivery 3005, media 3006, config 3008, review 3009, analytics 3010, inventory-grpc 50052. No named-port drift.
- `payment` (3007) and `notification` (3012) correctly have NO ingress policy — grep confirms no `*_SERVICE_URL` targets them; they are Kafka/Temporal workers with no inbound HTTP callers. Omission is correct, not a gap.
- DNS egress (`01`) allows both UDP and TCP 53 to kube-system — correct for CoreDNS incl. large/TCP-fallback responses.
- `default-deny-all` sets both Ingress and Egress policyTypes with `podSelector: {}` — true namespace floor.
- Dev egress is complete: all deps in-ns (postgres/redis) covered by `02`, DNS by `01`, telemetry disabled — no missing edge.
- kustomize wiring complete: `network-policies` present in base `resources`; the dir kustomization lists all 9 manifest files.
- namespaceSelectors use the auto-populated `kubernetes.io/metadata.name` label (kube-system, observability) — works on k3s ≥1.21.
- Labels are consistent kebab-case `app.kubernetes.io/name`; no typo'd selectors that would fail-open/closed.

---

## Recommended actions (priority order)
1. **C1 (blocker for prod):** add prod-overlay egress carve-out (`ipBlock` + ports) for external managed infra, or the whole app is down in prod.
2. **M1:** add a probe-verification line to the prod CNI note; confirm host-firewall/HostEndpoints off on the target CNI.
3. **M2:** add `delivery` to `ingress-keycloak` (or broaden to `part-of`) before keycloak runs in-ns.
4. **L2:** fix base OTLP endpoint to `otel-collector.observability:4318`.
5. **L1:** trim `order` from `ingress-temporal` unless it becomes a client.

## Unresolved questions
- L5: In what order/scope is `infra/k8s/observability` applied relative to the prod overlay? If not applied, prod OTLP + `03` are inert.
- C1: What is the real external-infra CIDR/egress policy plan for prod (8d/GitOps)? The overlay comment says values come from a secret manager but says nothing about the required egress allowance.
- M2: Do backend services validate JWT via a one-time JWKS fetch or per-request calls to keycloak? Affects how many services need keycloak ingress once it's in-ns.
