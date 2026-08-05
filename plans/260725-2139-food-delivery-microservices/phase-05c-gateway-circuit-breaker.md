# Slice 5c — Gateway circuit breaker (opossum, per-downstream)

Context: [phase-05.md](./phase-05-payment-resilience-notification.md) · [phase-01.md](./phase-01-auth-gateway-hardening.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P1 — third and last P5 slice (after 5a payment #18, 5b notification #19). Completes P5.
- **Status**: ✅ Verified live (adversarial review in progress) — branch `feat/gateway-circuit-breaker`. Per-downstream opossum breaker wraps `HttpForwarder`'s fetch. Live e2e (`RUN_GATEWAY_CB_E2E=1`) **passed against a REAL toggleable upstream + real RS256 JWKS**: catalog down → after the volume threshold the status flips **502→503** (breaker OPEN → fetch skipped, the 503 can only come from `EOPENBREAKER`), latency ≪ the 10s forward timeout; a DIFFERENT service (search) stays **200** throughout (per-service isolation); catalog back up → **200** after `CB_RESET_TIMEOUT_MS` (half-open probe closed it). Offline gates clean (tsc/biome/depcruise/knip + **30 gateway unit** tests). Branch `feat/gateway-circuit-breaker`.
- **Adversarial review + fixes applied** (report `../reports/code-reviewer-260729-2130-slice-5c-gateway-circuit-breaker-red-team-review-report.md`; breaker contract verified SOLID against opossum 10 source — EOPENBREAKER detection, `timeout:false`, success/failure wiring, no lazy-cache race, disabled pass-through, 503+Retry-After, identity forwarding all confirmed):
  - **H1 (High)** — a headers-then-stalled-body upstream hung the gateway forever AND was counted a breaker SUCCESS: undici resolves `fetch` on headers, so the abort timer was cleared before `arrayBuffer()` read the body. **Fixed**: the breaker action now reads the FULL body under the same AbortController, so a stalled body aborts → the action rejects → 504 and the breaker counts a failure (can open). Regression test added.
  - **M2 (Medium)** — body-read reject after `res.status()`/headers were set → 500 on an already-mutated response / `ERR_HTTP_HEADERS_SENT`. **Fixed by H1**: nothing is written to `res` until the full body is materialised.
  - **M3 (Medium)** — opossum's half-open admits >1 concurrent probe (no capacity cap); "single probe" was a spec overstatement. **Documented** in code + plan wording; steady-state fast-fail (the win) still holds.
  - **L4 (Low)** — AbortController/timer are now created inside the action, so none is allocated when the breaker is open.
- **Brief**: Wrap the gateway's downstream proxy calls in a **per-service circuit breaker** (`opossum`). Today `HttpForwarder.forward()` fails closed with 502/504 when a downstream is unreachable/slow — but EVERY request still waits the full 10s timeout during a sustained outage, tying up gateway resources. The breaker adds fail-FAST: after a downstream trips the error threshold, its breaker OPENS and subsequent requests return **503 + Retry-After immediately** (no fetch attempt, no 10s hang) until a half-open probe confirms recovery. Isolated per downstream — a dead `catalog` never fast-fails `order`.

## Key decisions (versions verified live 2026-07-29)
- **opossum 10.0.0** (verified **commonjs** — safe for the webpack/CJS build) + `@types/opossum 8.1.9`.
- **One breaker per downstream service** (catalog, auth, order, search, delivery, media), lazily created + cached in a `CircuitBreakerRegistry`, all configured from the same `CB_*` env. Per-service isolation is the whole point — a global breaker would let one bad service starve the others.
- **What trips it**: the breaker action is the existing fetch-with-abort-timeout. It rejects on a **connect failure or timeout** (downstream DOWN/hung) → the breaker counts a failure. A downstream **HTTP 5xx passes THROUGH** (resolves) and does NOT trip the breaker — the breaker guards "downstream unreachable", not "downstream app bug", and preserves the real error body. (Documented; a 5xx-as-failure policy can be added later if wanted.)
- **Open → fail fast**: `breaker.fire()` rejects with `EOPENBREAKER` when open → the forwarder maps that to **503 + `Retry-After`** immediately. Closed/half-open failures keep today's mapping (**502** unreachable, **504** timeout) and are recorded by the breaker.
- **opossum's own `timeout` disabled** (`timeout: false`) — the action's `AbortController` (`FORWARD_TIMEOUT_MS` = 10s) owns the timeout so there's ONE timeout mechanism; an abort rejects the action → the breaker counts it.
- **Config** (env, `CB_*`): `CB_ENABLED` (true; disabled in `test` like `RATE_LIMIT_ENABLED` so container-less suites don't need it), `CB_ERROR_THRESHOLD_PERCENT` (50), `CB_RESET_TIMEOUT_MS` (10000 — open→half-open delay), `CB_ROLLING_WINDOW_MS` (10000), `CB_VOLUME_THRESHOLD` (5 — min requests in the window before the % applies, so a single early failure can't open it).
- **Observability**: log `open`/`halfOpen`/`close` transitions with the service name. (A breaker-stats endpoint is YAGNI for this slice — events + logs suffice; full metrics land in P8.)
- **No new infra** — pure gateway code. No compose/DB change.

## Requirements
**Functional**: each downstream proxy call goes through its service's breaker; on sustained connect-failure/timeout the breaker opens and further calls to THAT service return 503 + Retry-After without attempting the upstream; after `CB_RESET_TIMEOUT_MS` the breaker goes half-open and probes the upstream (opossum admits any in-flight requests as probes, not strictly one) — success closes it, failure reopens it; other services are unaffected.
**Non-functional**: open-circuit response is FAST (≪ the 10s timeout); breakers isolated per service; disabled cleanly under `NODE_ENV=test`; identity/timeout/header behaviour of the forwarder otherwise unchanged; no breaker state shared across services.

## Architecture / data flow
```
client ─▶ proxy controller ─▶ HttpForwarder.forward(target{serviceName,prefix,baseUrl})
   └─ registry.breakerFor(serviceName)          # one cached opossum breaker per service
        breaker.fire(targetUrl, init)
          ├─ CLOSED/HALF-OPEN → action: fetch(+AbortController 10s)
          │     ├─ response (any status incl 5xx) → relay through (breaker: success)
          │     ├─ network error → reject → 502  (breaker: failure)
          │     └─ AbortError (timeout) → reject → 504 (breaker: failure)
          └─ OPEN → reject EOPENBREAKER → 503 + Retry-After (no fetch, immediate)
   transitions (open/halfOpen/close) logged per service
```

## Related code files
**Create — gateway:**
- `apps/gateway/src/proxy/circuit-breaker.registry.ts` — `CircuitBreakerRegistry` (Injectable): lazily builds + caches one `opossum` `CircuitBreaker` per `serviceName` from `CB_*` env; registers open/halfOpen/close event logs; `CB_ENABLED=false` → a pass-through that just runs the action (no breaker). Exposes `run(serviceName, action)` (or `breakerFor`).
- (optional) `apps/gateway/src/proxy/circuit-breaker-open.error.ts` — a small typed guard for the `EOPENBREAKER` case, or detect via `err.code === 'EOPENBREAKER'` inline.

**Modify — gateway:**
- `apps/gateway/src/proxy/http-forwarder.ts` — extract the fetch-with-timeout into an action; run it through `registry.run(target.serviceName, action)`; add the `EOPENBREAKER → 503 + Retry-After` branch alongside the existing 502/504. `ForwardTarget` gains `serviceName: string`.
- the 6 proxy controllers (`catalog/auth/order/search/delivery/media-proxy.controller.ts`) — pass `serviceName` in their `ForwardTarget` (each already owns its prefix constant).
- `apps/gateway/src/config/gateway-env-schema.ts` — add the `CB_*` vars.
- `apps/gateway/src/app.module.ts` — provide `CircuitBreakerRegistry`.
- `package.json` — add `opossum@10.0.0` + `@types/opossum@8.1.9`. `.env.example` — `CB_*` keys.

**E2E** (`apps/gateway-e2e/` or extend existing gateway smoke) — gated `RUN_GATEWAY_CB_E2E`: stand a stub upstream that can be toggled DOWN; fire > `CB_VOLUME_THRESHOLD` requests with it down → observe the transition from 502/504 to a FAST 503 (assert latency ≪ timeout); toggle it back → after `CB_RESET_TIMEOUT_MS` a request succeeds (breaker closed); a DIFFERENT service's breaker stays closed throughout (isolation).

## Implementation steps
1. Add `opossum` + `@types/opossum`; `CB_*` env schema + `.env.example`.
2. `CircuitBreakerRegistry` — per-service lazy breaker cache from env; event logs; `CB_ENABLED=false` pass-through; disabled in `test`.
3. Refactor `HttpForwarder` — action extraction, run through the registry, `EOPENBREAKER → 503 + Retry-After`; add `serviceName` to `ForwardTarget`; update the 6 controllers.
4. Wire the registry into `app.module.ts`.
5. Unit tests: registry opens after threshold failures + fast-fails when open + half-opens/closes on recovery (fake action + injectable clock/short reset); forwarder maps EOPENBREAKER→503, network→502, abort→504; a downstream 5xx passes through and does NOT trip.
6. **E2E**: fast-fail + recovery + per-service isolation against a toggleable stub upstream.
7. Update plan todos/status BEFORE push.

## Todo
- [x] opossum + @types/opossum deps; `CB_*` env schema + `.env.example`
- [x] `CircuitBreakerRegistry` (per-service lazy breaker, event logs, CB_ENABLED/test pass-through)
- [x] `HttpForwarder` runs the fetch action through the breaker; `EOPENBREAKER → 503 + Retry-After`; `ForwardTarget.serviceName`; 6 controllers updated
- [x] registry provided in `app.module.ts`
- [x] unit tests: open/fast-fail/half-open-recover + forwarder status mapping + 5xx pass-through
- [x] E2E written: fast-fail vs timeout, recovery after reset, per-service isolation (gated `RUN_GATEWAY_CB_E2E`, not yet executed live)
- [x] biome/cruiser/knip/tsc clean (gateway unit suite green); plan updated before push

## Success criteria
- With a downstream down, after the volume+error threshold the gateway returns **503 + Retry-After** for that service in ≪ the 10s timeout (fail fast), and stops hammering the dead upstream.
- After `CB_RESET_TIMEOUT_MS` a half-open probe closes the breaker once the downstream recovers → normal 2xx resumes.
- A dead downstream never trips another service's breaker (isolation).
- `NODE_ENV=test` runs with breakers disabled (pass-through); identity/header/timeout behaviour otherwise unchanged.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| opossum ESM/CJS build issue | L×M | Verified opossum@10 is commonjs; builds under webpack |
| Breaker opens on a transient blip | M×M | `CB_VOLUME_THRESHOLD` (min volume) + rolling-window % so one/two failures can't open it |
| 5xx wrongly tripping the breaker | L×M | 5xx passes through (resolve); only connect-failure/timeout counts — documented |
| Shared breaker across services | L×H | Registry keys per `serviceName`; isolation covered by an e2e assertion |
| Timeout double-counting (opossum + abort) | L×M | opossum `timeout:false`; the AbortController is the sole timeout |
| Test envs needing Redis/infra | L×L | `CB_ENABLED=false` in test (pass-through), mirrors `RATE_LIMIT_ENABLED` |

## Security considerations
- Fail-fast 503 carries no downstream internals — a generic body + `Retry-After` only; no leak of which host/why.
- Breaker state is in-memory per gateway instance (fine for the slice; multi-instance shared state is a P7/P8 concern, noted).
- No change to identity forwarding — the breaker wraps only the outbound fetch; the verified-identity header construction is untouched.

## Next steps
Completes P5. Feeds P8 (breaker metrics/dashboards + alerting on open transitions; per-instance vs shared state). Real downstream SLOs can tune `CB_*` per service later (per-service overrides) without touching the forwarder.
