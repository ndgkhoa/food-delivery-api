# Weighted-canary demo for gateway (Argo Rollouts)

Standalone from `infra/k8s/base` — applied on its own to demonstrate
automated progressive delivery. Requires the Argo Rollouts controller
(`infra/k8s/argo-rollouts`) installed first; the `Rollout` CRD is inert
without it.

The `gateway` Rollout selects `app.kubernetes.io/name: gateway`, the SAME label
as the base `gateway` Deployment, so scale the base one to 0 first (or apply
this on a cluster that doesn't run the base gateway) to avoid two controllers
managing the same pods:

```sh
kubectl apply -k infra/k8s/argo-rollouts
kubectl scale deploy/gateway -n food-delivery --replicas=0   # avoid the selector clash
kubectl apply -k infra/k8s/rollout/canary
```

The `gateway` Rollout starts all pods on `gateway-stable` (weight 100/0 on
`gateway-weighted`). A new revision (bump `image:` in `rollout.yaml`) steps:
`setWeight 10` -> 30s pause -> Prometheus analysis -> `setWeight 50` -> 30s
pause -> auto-promote to 100%. The controller drives the `gateway-weighted`
TraefikService weights automatically at each step.

The `gateway-success-rate` analysis aborts the canary if the non-5xx ratio stays
under 95% (`failureLimit` 2 of the 3 windows). For it to actually evaluate it
needs the observability stack up (`prometheus.observability:9090`), the
gateway's OTLP metrics reaching it, AND live traffic on the canary (run a load
generator during the rollout). With no metrics the query returns no rows, which
is treated as a pass — the demo still steps through the pauses.

Promotion is controller-driven, not hand-edited weights:

```sh
kubectl argo rollouts get rollout gateway -n food-delivery --watch
kubectl argo rollouts promote gateway -n food-delivery   # skip the current pause
kubectl argo rollouts abort gateway -n food-delivery     # roll back to stable
```

Verify the split locally: see the curl/kubectl-logs runbook in
`ingressroute.yaml`'s header comment.
