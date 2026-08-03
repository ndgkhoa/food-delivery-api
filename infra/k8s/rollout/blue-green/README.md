# Blue-green demo for gateway (Argo Rollouts)

Standalone from `infra/k8s/base` — applied on its own to demonstrate
automated progressive delivery. Requires the Argo Rollouts controller
(`infra/k8s/argo-rollouts`) installed first; the `Rollout` CRD is inert
without it. Scale the base `gateway` Deployment (`infra/k8s/base/gateway`)
to 0 first so it doesn't idle alongside this demo's Rollout — both target
the same `gateway` Service name/namespace.

```sh
kubectl apply -k infra/k8s/argo-rollouts
kubectl apply -k infra/k8s/rollout/blue-green
```

`autoPromotionEnabled: false` — a new revision (bump `image:` in
`rollout.yaml`) scales up behind `gateway-preview` and waits for manual
promotion; `gateway` keeps serving the old ReplicaSet until then.

```sh
kubectl argo rollouts get rollout gateway -n food-delivery --watch
kubectl argo rollouts promote gateway -n food-delivery   # cut gateway over
kubectl argo rollouts undo gateway -n food-delivery      # rollback
```

The old ReplicaSet stays warm for `scaleDownDelaySeconds: 30` after
promotion before the controller scales it down — that's the rollback
window.
