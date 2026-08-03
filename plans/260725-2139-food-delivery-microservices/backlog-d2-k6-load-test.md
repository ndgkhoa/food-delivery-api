# Backlog D2 — k6 load test (SLO-aligned)

Context: [plan.md](./plan.md) · [phase-08b-metrics-logs-slo.md](./phase-08b-metrics-logs-slo.md) · [phase-08c-b-hpa-canary-rollout.md](./phase-08c-b-hpa-canary-rollout.md)

## Overview
- **Priority**: portfolio-plus — second D-item.
- **Status**: ✅ Verified live — branch `feat/k6-load-test`. Awaiting review/merge.
  - **Live proof (real stack: keycloak dev realm + gateway + catalog + order + infra)**: `k6 run` authenticated via Keycloak ROPC (`customer-user`), then drove both scenarios. Result: **checks 100%** (735/735 — browse list 200, browse detail 2xx, **order place 2xx**), **http_req_failed 0.00%** (0/738), p95 19.7ms (browse 10.7ms / order 45.5ms), order p99 53ms — **every SLO-aligned threshold PASS**. The order write path returns 2xx (POST persists + kicks the saga async) without inventory/payment/Temporal up, as designed. Manual pre-check confirmed the gateway enforces auth (no token → 401, token → 200) and the catalog list is a `{data,total,page,limit}` envelope (the `asArray` extractor handles it). `k6 inspect` + biome clean.
  - **Operational caveat found + documented**: all VUs share one identity → one per-identity rate-limit bucket, so the run needs the gateway limiter disabled/sized (or multiple users), else it measures 429s. Verified with `RATE_LIMIT_ENABLED=false`; noted in the README.
  - **Adversarial review + fixes** (report `reports/code-reviewer-260803-k6-load-test-review-report.md`; the script is correct + safe as verified — every finding was about claim-accuracy or behaviour under the README's advertised overrides, not the default run; secret/prod-safety + Idempotency-Key uniqueness confirmed airtight):
    - **H1** — `http_req_failed` used k6's default expected statuses (200–399), so 4xx counted as failures, but it claimed to mirror `HighHttp5xxRate` (5xx-only). A 429/401 run would trip it with zero 5xx. **Fixed**: `http.setResponseCallback(http.expectedStatuses({min:200,max:499}))` → only 5xx (+ network errors) count as failed; 4xx surfaces as a `checks` failure. Now a true 5xx mirror.
    - **M1** — the untagged global `http_req_duration p(99)<1000` also covered order, undermining the looser order budget. **Fixed**: duration thresholds are now per-scenario only (`{scenario:browse}` p95<500/p99<1000, `{scenario:order}` p95<800/p99<1500).
    - **M2** — the order VU pool was fixed (`preAllocatedVUs:5`/`maxVUs:20`) → starves at high `ORDER_RATE`, silently dropping iterations. **Fixed**: pool scales off `ORDER_RATE` + a `dropped_iterations: count<1` threshold surfaces under-delivery.
    - **M3** — one token minted in `setup()`, never refreshed → a run longer than the token lifespan (Keycloak default 5 min) 401-storms. **Fixed** (doc): README documents keeping runs under the token lifespan.
    - Lows fixed: setup probes tagged `scenario:setup` (out of the latency populations); `browse()` guards the picked restaurant's `.id` (a missing id no longer reads as a 404/SLO failure).
    - Re-validated: `k6 inspect` parses (pool 6/20, per-scenario thresholds + `dropped_iterations`), biome clean. Config-only refinements over an already-green full live run (p95 20ms, 0% 5xx, 0 dropped — all within the new budgets).
- **Brief**: No load test exists. Add a **k6** script that drives the gateway through realistic authenticated traffic (browse-heavy read + a write path) with thresholds aligned to the 8b SLO alert rules, so the HPA/canary behaviour (8c-B) and the golden-signal SLOs (8b) can be exercised under load. k6 is installed locally (`/opt/homebrew/bin/k6`).

## Design
- **Location**: `infra/load-test/load-test.js` (the k6 script) + `infra/load-test/README.md` (how to run, prerequisites). Grouped with the other ops artifacts under `infra/`.
- **Auth (`setup()`)**: every `/api/v1/*` route requires a JWT (global `JwtAuthGuard`; only `/health` is `@Public()`). `setup()` mints a **customer** token from the DEV Keycloak realm via ROPC (`POST {KEYCLOAK_URL}/realms/food-delivery/protocol/openid-connect/token`, `client_id=food-delivery-spa`, `username=customer-user`, `password=customer-pass`, `grant_type=password`) — the dev realm enables `directAccessGrants` + seeds these users precisely so tooling can do this. (The PROD realm disables ROPC — this is a dev/load-test-only path, documented.) `setup()` also fetches a restaurant + its first menu item to build a valid order payload; if none exist, the order scenario checks-skip gracefully.
- **Scenarios** (k6 `scenarios`, tagged):
  - `browse` (ramping-vus, the bulk of traffic): `GET /api/v1/catalog/restaurants` (list) then a `GET /api/v1/catalog/restaurants/:id` — the read path HPA/latency SLOs care about.
  - `order` (constant-arrival-rate, lower): `POST /api/v1/orders` with `{items:[{itemId,qty}]}` + a fresh `Idempotency-Key` per iteration (the write path; returns 201 as the order is persisted + the saga kicked off async).
- **Thresholds (aligned to `infra/prometheus/alert-rules.yml`)**:
  - `http_req_failed: rate<0.05` (mirrors `HighHttp5xxRate > 0.05`).
  - `http_req_duration: p(99)<1000` (mirrors `HighHttpP99Latency` p99 > 1s) + a tighter `p(95)<500`.
  - `checks: rate>0.99`; per-scenario tagged duration thresholds so a slow write can't hide behind fast reads.
- **Config**: `GATEWAY_URL` (default `http://localhost:3000`), `KEYCLOAK_URL` (default `http://localhost:8080`), plus VUs/duration overridable via k6 env/CLI. Default profile is a SHORT modest run (portfolio-friendly), scalable via env.
- **Not wired into CI**: running k6 against a live full stack in CI is heavy + flaky; the deliverable is the script + a documented local run. (A future CI smoke could run it against an ephemeral stack — noted, not built.)

## Related files
- NEW `infra/load-test/load-test.js`, `infra/load-test/README.md`.

## Todo
- [x] `load-test.js`: setup() auth (ROPC) + order-seed fetch; browse + order scenarios; SLO-aligned thresholds; env-configurable
- [x] `README.md`: prerequisites, how to run, env vars, threshold rationale, ROPC-is-dev-only + rate-limit notes
- [x] verify live: k6 against a locally-served stack — auth works, browse 200s, order 2xx, all thresholds pass (checks 100%, 0% failed)
- [x] plan updated before push

## Success criteria
- `k6 run infra/load-test/load-test.js` against a running local stack authenticates, drives browse + order traffic, and reports per-scenario latency + the pass/fail of the SLO-aligned thresholds.
- Thresholds mirror the 8b Prometheus SLO rules (5% error budget, p99 < 1s).
- The script is env-configurable (URLs, load) and does not hard-code secrets (dev test-user creds are non-secret + documented; prod ROPC is disabled).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Order scenario needs seed data (restaurant+item) | M×M | `setup()` fetches it; scenario checks-skips when absent — the browse path still loads the stack |
| Full saga (inventory/payment/Temporal) not up → order POST 5xx | M×M | POST persists the order + kicks the saga async → 201 without the saga completing; verify in the smoke run, else document the order scenario needs the full stack |
| ROPC creds/flow only in dev | L×L | Documented dev-only; prod realm disables direct grants (04c) — the load test targets a dev/staging stack, never prod with these creds |
| Thresholds too strict/loose vs real infra | L×M | Aligned to the existing Prometheus alert rules; overridable; documented |

## Security considerations
- Dev test-user credentials (`customer-user`/`customer-pass`) are non-secret fixtures from the dev realm, already in `realm-export.json`; not a leak. Prod ROPC is disabled (04c), so this script cannot mint prod tokens. No secrets committed.

## Next steps
Remaining D-items: Argo Rollouts, cosign/SLSA provenance. (Docs/README + CI badges deferred by the user.)
