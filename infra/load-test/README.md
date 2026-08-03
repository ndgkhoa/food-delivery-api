# k6 load test

Drives the API gateway through realistic authenticated traffic — a browse-heavy
read path plus a lower-rate order write path — with thresholds aligned to the
production SLO alert rules.

## Prerequisites

A running stack reachable from the machine you run k6 on:

- **Gateway** (default `http://localhost:3000`) + the **catalog** and **order**
  services behind it.
- **Keycloak** (default `http://localhost:8080`) with the **dev** realm
  (`infra/keycloak/realm-export.json`) imported — the script authenticates as the
  seeded `customer-user` via the resource-owner-password grant, which the dev
  realm enables. (The prod realm disables direct grants — see
  `infra/keycloak/README.md` — so this script targets dev/staging, never prod.)
- Redis + Postgres + Kafka (the services' own dependencies).

Bring the stack up however you normally do (e.g. `docker compose -f
infra/docker-compose.yml up`, or `pnpm nx serve <gateway|catalog|order>` plus a
Keycloak container).

## Run

```bash
k6 run infra/load-test/load-test.js
```

Override the target and load via env vars:

```bash
GATEWAY_URL=https://staging-gateway.example.com \
KEYCLOAK_URL=https://staging-keycloak.example.com \
BROWSE_VUS=50 ORDER_RATE=10 HOLD=2m \
  k6 run infra/load-test/load-test.js
```

| Env | Default | Meaning |
|-----|---------|---------|
| `GATEWAY_URL` | `http://localhost:3000` | Gateway base URL |
| `KEYCLOAK_URL` | `http://localhost:8080` | Keycloak base URL |
| `KC_USER` / `KC_PASS` | `customer-user` / `customer-pass` | Dev realm login |
| `BROWSE_VUS` | `15` | Peak virtual users on the browse scenario |
| `ORDER_RATE` | `3` | Orders/sec on the write scenario |
| `HOLD` | `40s` | Steady-state duration |

## Scenarios

- **browse** (`ramping-vus`) — `GET /api/v1/catalog/restaurants` then a random
  restaurant detail. The read path the latency SLO and read-side HPA care about.
- **order** (`constant-arrival-rate`) — `POST /api/v1/orders` with a fresh
  `Idempotency-Key`. The POST persists the order and starts the saga
  asynchronously (returns 201 before the saga settles), so it measures
  order-creation latency, not saga completion. `setup()` fetches a real
  restaurant + menu item for the payload; if the catalog is empty the order
  scenario is a no-op and only the browse path loads the stack.

## Thresholds

Aligned to `infra/prometheus/alert-rules.yml`, so a run that fails them would
also trip the deployed SLO alerts:

- `http_req_failed: rate<0.05` — mirrors `HighHttp5xxRate` (> 5% 5xx). The
  script sets a response callback so **only 5xx (and network errors) count as
  failed**; 4xx (a 429 from the shared rate-limit bucket, a 401 from an expired
  token) shows up as a `checks` failure instead, keeping this metric a true
  5xx mirror.
- `http_req_duration{scenario:browse}: p(99)<1000` / `{scenario:order}:
  p(99)<1500` — the read path mirrors `HighHttpP99Latency` (p99 > 1s); the write
  path gets a looser budget. Per-scenario so neither masks the other.
- `checks: rate>0.99` — nearly all functional checks pass.
- `dropped_iterations: count<1` — the write pool kept up with `ORDER_RATE`.

## Notes

- **Rate limiting**: every VU authenticates as the same `customer-user`, so they
  share one per-identity rate-limit bucket at the gateway (`RATE_LIMIT_MAX` per
  `RATE_LIMIT_WINDOW_SEC`). Above that rate the gateway returns 429 and the run
  measures throttling, not backend latency. For a real load run either raise/
  disable the limit on the target (`RATE_LIMIT_ENABLED=false`), size
  `RATE_LIMIT_MAX` to the intended load, or extend the script to authenticate as
  several users. (Verified locally with the limiter disabled.)
- **Run length**: `setup()` mints one token and never refreshes it, so keep a run
  shorter than the realm's access-token lifespan (Keycloak default 5 min).
  A longer `HOLD` outliving the token would 401-storm (and, per the note above,
  show as check failures, not 5xx). For sustained runs, shorten `HOLD` or extend
  the script to re-auth per VU.
- The dev test-user credentials are non-secret fixtures from the dev realm, not a
  leak. This script cannot mint prod tokens (prod ROPC is disabled).
- Not wired into CI: running k6 against a live full stack in CI is heavy and
  flaky. A future CI smoke could run it against an ephemeral stack.
