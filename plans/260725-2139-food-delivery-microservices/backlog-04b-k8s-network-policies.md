# Backlog 04b — K8s NetworkPolicy (default-deny + explicit allows)

Context: [plan.md](./plan.md) (Deferred backlog) · [backlog-04a-signed-internal-identity.md](./backlog-04a-signed-internal-identity.md)

## Overview
- **Priority**: security — second of three security slices (04a signed identity → **04b NetworkPolicy** → 04c prod Keycloak realm).
- **Status**: ✅ Verified live (enforcement proven on k3d) — branch `feat/k8s-network-policies`. Awaiting review/merge.
  - **Live enforcement proof (real k3d)**: 21 NetworkPolicies; `kubectl kustomize` base+dev+prod build, `kubectl apply --dry-run=server` validates all 21, kubeconform strict clean. Crucially — contrary to the "flannel doesn't enforce" assumption below, **k3s/k3d DO enforce NetworkPolicy** (bundled kube-router controller). Proven in a throwaway namespace mirroring the real policies: under `default-deny-all` + `ingress-catalog-grpc` (from `order` only), a pod labeled `order` **connected** to the catalog gRPC port (HTTP 404 from the stand-in httpd = TCP reached) while a pod labeled `gateway` was **refused** — same IP:port, opposite outcomes ⇒ enforcement is real AND the order-only gRPC selector isolates correctly. This is the concrete **H2 backstop** working: only `order` may reach catalog/inventory `:50051`.
  - **otel-collector cross-namespace fix (found during review of the build)**: the collector runs in the `observability` namespace, but the namespace-confined egress (`02`) only permits egress within `food-delivery` → in prod (endpoint `otel-collector.observability:4318`, enforced) OTLP push would be silently dropped, breaking P8 telemetry. **Fixed**: removed the inert food-delivery otel-collector INGRESS policy (the collector isn't here; its ingress belongs with the observability manifests) and added `03-allow-otlp-egress-to-observability.yaml` — a narrow egress carve-out to the observability namespace on the OTLP ports (4318/4317). Preserves default-deny; restores the one legitimate cross-ns flow.
  - **Adversarial review + fixes** (report `../reports/code-reviewer-260803-k8s-network-policies-review-report.md`; gRPC lock-down + numeric ports + payment/notification having no ingress all verified correct):
    - **C1 (CRITICAL — prod outage)**: the prod overlay repoints EVERY datastore/broker/auth to EXTERNAL managed hosts (outside the pod/service CIDR), but the egress model is namespace-confined → a prod default-deny egress drops all DB/redis/kafka/temporal/auth connections; every pod fails to start. CI/kustomize can't catch it (only a live prod apply would). **Fixed**: added a prod-only `allow-external-infra-egress` NetworkPolicy (port-scoped egress to external hosts: 5432/6379/9092/7233/9200/8123/9000/443/587/465/25) — a documented TEMPLATE (`cidr: 0.0.0.0/0`, to be scoped to the real managed-infra subnet at deploy). Base 21 → prod 22.
    - **M1 (probes on other CNIs)**: kubelet httpGet probes survive default-deny on k3s (verified) but a host-firewall CNI may filter them → added a probe-verification line to the prod CNI note.
    - **M2 (keycloak ingress incomplete)**: `delivery` also carries `KEYCLOAK_URL` (confirmed: gateway+auth+delivery) but was omitted → added `delivery` to `ingress-keycloak`.
    - **L1 (temporal over-permission)**: `ingress-temporal` allowed `order`, which has no Temporal config (only `payment` does) → removed `order`.
    - **L4 (redundant selector)**: `ingress-config` listed `gateway` explicitly AND `part-of: food-delivery` (which already covers it) → deduped to `part-of` only.
    - Accepted (documented): **L3** datastore ingress uses the broad `part-of` selector — the stated coarse egress/ingress model (strict per-service on HTTP/gRPC receivers, coarse on shared infra). **L2** base configmaps point OTLP at `otel-collector.food-delivery` (pre-existing; dev telemetry off, prod overlay patches it to `.observability`) — out of NetworkPolicy scope, left as a separate follow-up. **L5** the `observability` stack is applied as its own kustomization (P8), not via these overlays — confirmed intended.
- **Brief**: The `food-delivery` namespace has **no NetworkPolicy** — every pod can reach every other pod on any port. This is the network half of the trust story 04a started: 04a signs the HTTP identity, but the gRPC east-west edge (`order`→catalog/inventory `:50051`) was left to network isolation (H2 decision). Add a **default-deny** baseline + **explicit ingress allows** so each service accepts connections ONLY from its legitimate callers — in particular catalog/inventory gRPC accept ONLY `order`, which is the primary control backstopping 04a's deferred gRPC edge.

## Topology (all in the `food-delivery` namespace — scouted from base configmaps/deployments)
- **Edge**: Traefik ingress (k3d default, `kube-system`) → `gateway:3000` (http). Only the gateway is publicly reachable.
- **Gateway → backends (HTTP)**: gateway proxies to `catalog:3001`, `auth:3002`, `order:3003`, `search:3004`, `delivery:3005`, `media:3006`, `config:3008`, `review:3009`, `analytics:3010`. (`inventory` is NOT gateway-proxied — gRPC only.)
- **East-west gRPC**: `order` → `catalog:50051` + `inventory:50052`. These are the H2 edge.
- **East-west HTTP**: services → `config:3008` (`CONFIG_SERVICE_URL` in order/payment/… configmaps) — config is called by the gateway AND by other services.
- **Shared infra (in-ns)**: `postgres:5432`, `redis:6379`, `kafka:9092`, `temporal:7233` (payment), `keycloak:8080` (gateway+auth JWKS/token), `otel-collector:4318` (all — OTLP).
- **Metrics = push model**: apps push OTLP → otel-collector; Prometheus scrapes ONLY otel-collector + itself (confirmed in `observability/prometheus/configmap.yaml`). So app pods need **no ingress from Prometheus** — a default-deny ingress does NOT break metrics.
- **Labels**: every pod carries `app.kubernetes.io/name: <svc>` + `app.kubernetes.io/part-of: food-delivery`. Selectors use these; no manifest re-labeling needed.

## Policy model (KISS: strict ingress microsegmentation + namespace-confined egress)
NetworkPolicy is enforced at BOTH ends. The security backbone is **ingress** (who may RECEIVE) — done strictly per-service. **Egress** is coarse (confined to the namespace + DNS): a permissive-within-namespace egress does NOT weaken microsegmentation because each receiver's ingress still refuses a connection unless the source is whitelisted, but it keeps egress simple and stops any pod exfiltrating OUT of the namespace. All resources live in a new `infra/k8s/base/network-policies/` dir (+ kustomization), so the whole policy set is reviewed/verified in one place.

Baseline:
1. **`default-deny-all`** — `podSelector: {}`, `policyTypes: [Ingress, Egress]`, no rules → denies all ingress+egress for every pod in the namespace.
2. **`allow-dns-egress`** — all pods → `kube-system` kube-dns, UDP+TCP 53 (mandatory, else every DNS lookup fails).
3. **`allow-egress-within-namespace`** — all pods may egress to any pod in `food-delivery` (covers app→infra postgres/redis/kafka/temporal/keycloak/otel AND east-west app→app senders). Egress outside the namespace stays denied (except DNS).

Ingress allows (the microsegmentation — one policy per receiver):
4. **`gateway`** ← Traefik: from `kube-system` (namespaceSelector `kubernetes.io/metadata.name: kube-system`) on `http:3000`. (Learning note: k3d Traefik lives in kube-system; a stricter podSelector on the Traefik pod is a documented tightening.)
5. **backend HTTP services** (`catalog:3001`, `auth:3002`, `order:3003`, `search:3004`, `delivery:3005`, `media:3006`, `review:3009`, `analytics:3010`) ← `gateway` pods on their http port — one ingress policy each.
6. **`config:3008`** ← `gateway` **AND** all `food-delivery` app pods (east-west HTTP callers) — a two-`from` ingress policy.
7. **`catalog:50051` (gRPC)** ← `order` ONLY. **`inventory:50052` (gRPC)** ← `order` ONLY. `inventory` has NO http ingress (not gateway-proxied). — the H2 backstop.
8. **infra ingress**: `postgres:5432` ← app pods; `redis:6379` ← app pods; `kafka:9092` ← app pods; `otel-collector:4318` ← app pods; `temporal:7233` ← `payment` (+`order`) ; `keycloak:8080` ← `gateway`+`auth`. (kafka/temporal/keycloak have no base Deployment yet — the policies select by label and are inert until those pods exist; harmless + forward-looking. Note in the manifest.)

## CNI enforcement (CORRECTED — verified live)
Initial assumption was "k3d/k3s flannel doesn't enforce NetworkPolicy" — **that is wrong for k3s**: k3s bundles a kube-router-based NetworkPolicy controller, so k3d enforces out of the box. **Verified live** (see Status): a non-`order` pod is refused on the catalog gRPC port while `order` connects. The only non-enforcing cases are a stack with NO policy controller (plain flannel without one, or k3s `--disable-network-policy`). Prod requirement: confirm the managed CNI (Calico/Cilium/cloud-native) enforces — documented in the prod overlay + the `network-policies/README.md`. Verification performed: (a) `kustomize` base/dev/prod build, (b) `kubectl apply --dry-run=server` on all 21, (c) kubeconform strict, (d) **live enforcement proof on k3d** (the order-vs-gateway asymmetry).

## Related files (create)
- `infra/k8s/base/network-policies/00-default-deny-all.yaml`, `01-allow-dns-egress.yaml`, `02-allow-egress-within-namespace.yaml`
- `infra/k8s/base/network-policies/ingress-gateway.yaml`, `ingress-backends.yaml` (or per-service), `ingress-config.yaml`, `ingress-grpc-catalog.yaml`, `ingress-grpc-inventory.yaml`, `ingress-infra.yaml`
- `infra/k8s/base/network-policies/kustomization.yaml` — lists them
- `infra/k8s/base/kustomization.yaml` — add `network-policies` to resources
- `infra/k8s/overlays/prod/kustomization.yaml` — note: requires a policy-enforcing CNI

## Todo
- [x] `default-deny-all` + `allow-dns-egress` + `allow-egress-within-namespace` baseline
- [x] gateway ← Traefik (kube-system) ingress
- [x] backend HTTP services ← gateway ingress (per service, correct ports)
- [x] config ← gateway + all app pods (east-west) ingress
- [x] catalog/inventory gRPC ← order-only ingress (the H2 backstop) — enforcement verified live on k3d
- [x] infra ingress (postgres/redis/kafka ← app; temporal ← payment+order; keycloak ← gateway+auth); otel egress carve-out to observability ns
- [x] kustomization wiring; `kubectl kustomize` base+dev+prod build clean; `kubectl apply --dry-run=server` validates all 21; prod overlay CNI note (corrected)
- [x] plan updated before push

## Success criteria
- `kubectl kustomize` (base+dev+prod) builds; `kubectl apply --dry-run=server` validates every policy.
- Structural: catalog/inventory gRPC ingress `from` = `order` only; every gateway-proxied backend ingress `from` = gateway; config also from app pods; gateway ingress from kube-system; infra reachable by app pods; DNS egress present (nothing self-isolates).
- (If a Calico k3d is stood up) a non-`order` pod is REFUSED on `catalog:50051` while `order` succeeds; a non-`gateway` pod is REFUSED on `catalog:3001`; app→postgres + DNS still work.
- Metrics unaffected (push model — no app-pod scrape ingress required).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| ~~Policies inert on default k3d flannel~~ (DISPROVEN) | — | k3s bundles a kube-router policy controller → k3d ENFORCES; verified live (order-vs-gateway asymmetry). Prod note reframed to "confirm the CNI enforces / don't `--disable-network-policy`" |
| Default-deny egress breaks DNS → total outage | M×H | `allow-dns-egress` first; verify every kustomize build includes it; DNS is the classic first casualty |
| Missed an east-west caller → runtime connection refused | M×M | Egress is namespace-wide (senders never blocked intra-ns); only ingress is strict, and the caller map is scouted from configmaps; config's multi-caller ingress explicitly widened |
| kafka/temporal/keycloak have no base pods → dangling selectors | L×L | Label-selector policies are inert until the pods exist; harmless, forward-looking, noted in the manifest |
| Prometheus scrape broken by default-deny ingress | L×M | Confirmed push model (scrape targets otel-collector only), so no app-pod scrape ingress needed — no breakage |

## Security considerations
- Default-deny is the right posture: an attacker landing in one pod can no longer freely pivot to every service/DB. The gRPC order-only ingress is the concrete backstop for 04a's unsigned east-west edge.
- Egress is namespace-confined (blocks exfiltration OUT of the namespace) but intentionally coarse WITHIN it — the strict ingress side carries the microsegmentation, so this is a deliberate simplicity/strength trade-off, not a gap.
- Enforcement depends on the CNI: on flannel these are advisory. Prod MUST run Calico/Cilium — documented as a hard requirement, not a nicety.

## Next steps
04c — prod Keycloak realm hardening (token lifetimes, client scopes, brute-force detection, remove dev defaults). Optional later: HMAC-sign gRPC metadata (mirror 04a east-west). Then D-items (Argo Rollouts, cosign/SLSA, k6, BullMQ propagation).
