# NetworkPolicy set

Default-deny model for the `food-delivery` namespace: `00-default-deny-all.yaml`
blocks all ingress and egress for every pod, then each other file carves out
one specific, minimal allow.

- `01-allow-dns-egress.yaml` / `02-allow-egress-within-namespace.yaml` — the
  baseline every pod needs (DNS resolution, and reaching any other pod inside
  the namespace). Egress leaving the namespace stays denied except DNS.
- `03-allow-otlp-egress-to-observability.yaml` — the OpenTelemetry collector
  runs in the `observability` namespace, so this is the one legitimate egress
  OUT of `food-delivery` besides DNS; scoped to the collector's OTLP ports.
- `ingress-gateway.yaml` — only the gateway accepts traffic from outside the
  namespace (from `kube-system`, where k3d's Traefik runs).
- `ingress-backends.yaml`, `ingress-config.yaml`, `ingress-grpc.yaml`,
  `ingress-infra.yaml` — per-receiver ingress allow-lists, one `NetworkPolicy`
  per service/dependency, matching the caller map in
  `plans/260725-2139-food-delivery-microservices/backlog-04b-k8s-network-policies.md`.

## CNI enforcement

NetworkPolicy objects are always accepted by the Kubernetes API, but they are
only **enforced** by a stack that implements the NetworkPolicy API. **k3s/k3d
enforce out of the box** — despite using flannel for the pod network, k3s
bundles a kube-router-based NetworkPolicy controller. This was verified on this
repo's k3d cluster: under `00-default-deny-all` + `ingress-catalog-grpc`, a pod
labeled `order` connects to the catalog gRPC port while a pod labeled `gateway`
is refused — so the default-deny + per-service model is a real boundary here,
not just a valid-but-inert set of objects.

The only failure mode is a stack with NO policy controller: plain flannel
without one, or k3s started with `--disable-network-policy`. On a managed prod
cluster, confirm the CNI (Calico/Cilium/cloud-native) enforces NetworkPolicy
(see the prod overlay note).
