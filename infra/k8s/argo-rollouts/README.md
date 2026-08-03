# Argo Rollouts controller

Cluster add-on that drives the `Rollout` CRDs in `infra/k8s/rollout/{canary,blue-green}`
— install once per cluster, applies cluster-wide (own `argo-rollouts` namespace),
independent of the `food-delivery` base/overlays apply set.

Use `--server-side`: the upstream install bundles large CRDs whose full schema
can exceed the 262144-byte client-side `last-applied-configuration` annotation
limit.

```sh
kubectl apply -k infra/k8s/argo-rollouts --server-side
kubectl -n argo-rollouts rollout status deploy/argo-rollouts
```

`kubectl argo rollouts` plugin (for `get rollout --watch` / `promote` / `abort`):

```sh
brew install argoproj/tap/kubectl-argo-rollouts
# or: curl -sSL -o kubectl-argo-rollouts \
#   https://github.com/argoproj/argo-rollouts/releases/download/v1.9.1/kubectl-argo-rollouts-darwin-amd64 \
#   && chmod +x kubectl-argo-rollouts && sudo mv kubectl-argo-rollouts /usr/local/bin/
```
