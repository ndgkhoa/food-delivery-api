# Code Review — k6 load test (`infra/load-test/`)

Branch: `feat/k6-load-test` (untracked files). Scope: `load-test.js` (154 LOC) + `README.md`.
Context accepted as given: ran live against real stack, checks 100% (735/735), `http_req_failed` 0.00%, all thresholds pass, browse + order POST→2xx work. Not re-flagging anything as unrun.

Weighting: this is a measurement artifact. Findings ranked by "would it make the test measure / assert something other than it claims, or mislead the operator." Pure style down-ranked.

## Verdict
Solid, correct-under-the-tested-config script. Graceful degradation, secret hygiene, and idempotency-key uniqueness are all sound. The findings below are about **claim accuracy** and **behavior under the overrides the README itself advertises** (staging URLs, higher `ORDER_RATE`, longer `HOLD`) — none reproduce on the default local run that was verified, which is why they passed unnoticed.

---

## High

### H1 — `http_req_failed` counts 4xx as failure; comment + README claim it "mirrors" the 5xx-only alert
`load-test.js:50` + `README.md:64` (and the block comment `load-test.js:46-48`).

`http_req_failed: ['rate<0.05']` uses k6's default response callback (expected statuses 200–399), so **401 / 403 / 429 are all counted as failures**. The alert it claims to mirror, `HighHttp5xxRate` (verified `infra/prometheus/alert-rules.yml:11-16`), is **5xx-only** (`http_response_status_code=~"5.."`). Two concrete divergences:
- A rate-limited run (the exact 429 scenario the README's own Notes section describes) trips `http_req_failed` even though **no** production 5xx alert would fire → the operator reads "SLO failed" when the SLO was fine.
- Token-expiry / auth 401s (see M3) likewise fail this threshold with zero 5xx.

So the headline "a run that fails them would also trip the deployed SLO alerts" (`README.md:61-62`) is not true for the failure-rate threshold — it is strictly stricter and fires on classes the alert ignores.

Fix (pick one):
- To genuinely mirror 5xx: `import http; http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));` at module top so only 5xx count as failed. Then the threshold matches the alert.
- Or keep current behavior (arguably useful — surfaces 429/401) but reword the comment + README to "any non-2xx/3xx < 5%, which is *stricter* than the 5xx-only alert," and drop the "would also trip" equivalence claim.

Ranked High because SLO-alignment is the script's entire stated purpose, and the mismatch bites precisely in the two conditions the README tells you to expect (rate limiting, and — H1-adjacent — longer runs).

---

## Medium

### M1 — global `http_req_duration p(99)<1000` also covers order requests, making the looser `{scenario:order} p(99)<1500` budget partly illusory
`load-test.js:51-53`.

The untagged `http_req_duration: ['p(95)<500','p(99)<1000']` aggregates **every** request, orders included. So the intent — "orders get a looser 1500ms budget" (`:53`) — is only half-realized: an order population sitting at 1200ms p99 passes its own `{scenario:order}` threshold but still feeds the global `p(99)<1000`. In practice browse dominates volume so the global p99 is browse-driven and slow orders may hide, which means the looser order budget is *neither cleanly enforced nor cleanly exempted* — it depends on traffic mix, not on intent.

Fix: scope the global latency threshold to the read path so each scenario owns exactly one budget:
```
'http_req_duration{scenario:browse}': ['p(95)<500', 'p(99)<1000'],
'http_req_duration{scenario:order}':  ['p(99)<1500'],
```
Drop the untagged `http_req_duration` line (or keep it only as an informational, non-blocking aggregate). This makes the per-scenario numbers mean what they say.

### M2 — `constant-arrival-rate` VU pool is fixed, not scaled to `ORDER_RATE` → silent dropped iterations at the loads the README advertises
`load-test.js:41-42` (`preAllocatedVUs: 5`, `maxVUs: 20`).

Arrival-rate executors drop iterations (metric `dropped_iterations`, only a stderr warning) when the VU pool can't keep the target rate under latency. Defaults (3/s, fast 201) are fine — that's the verified run. But the README's own example (`README.md:35`) suggests `ORDER_RATE=10`, and staging latency can be far above the ~ms of local. At 10/s with order latency near the allowed p99 (1.5s) you need ~15 VUs; a slower staging tail blows past `maxVUs:20` and k6 **silently under-delivers the write rate** — you think you loaded 10 orders/s, you loaded fewer, and the latency numbers are for a lighter load than reported.

Fix: derive the pool from the rate, e.g. `preAllocatedVUs: Math.max(5, ORDER_RATE * 2)`, `maxVUs: Math.max(20, ORDER_RATE * 8)`, and/or document "watch for `dropped_iterations` in the summary — if non-zero, raise `maxVUs`." At minimum add the dropped-iterations caveat to the README so a non-zero count isn't missed.

### M3 — single token minted once in `setup()`, never refreshed → runs longer than the access-token lifespan 401-storm and falsely fail thresholds
`load-test.js:101-116` (token minted once, reused by every iteration for the whole run).

Keycloak access tokens are short-lived (dev realm default on the order of minutes). Default `HOLD=40s` is safe. But the README advertises `HOLD=2m` (`:35`) and nothing caps it — a `HOLD=10m` run outlives the token, every request 401s past that point, and both `http_req_failed` (H1) and `checks` collapse — reported as an SLO failure that's really a fixture-lifetime artifact.

Fix: document the ceiling ("keep total run < access-token lifespan, ~Xm, or the token expires mid-run") and/or re-mint on 401. For the intended short runs a documented ceiling is sufficient (YAGNI on full refresh logic).

---

## Low

### L1 — setup catalog GETs are untagged, so setup latency lands in the global request SLO population
`load-test.js:106, 110`. `mintToken` correctly tags `scenario:'setup'` (`:89`), but the two catalog GETs in `setup()` carry no scenario tag → they count toward the untagged `http_req_duration` p95/p99 threshold. Statistically negligible (2–3 requests vs 735) but conceptually setup shouldn't score against the request SLO. Fix: pass `{ ...auth, tags: { scenario: 'setup' } }` on `:106`/`:110`. (Moot if M1 scopes the latency thresholds per-scenario — then setup is excluded automatically.)

### L2 — `browse()` doesn't guard the picked element's `.id` the way `setup()` does
`load-test.js:129`. `setup()` guards `restaurants[0].id` (`:108`) but `browse()` does `restaurants[...].id` unguarded. A catalog row missing `id` yields `.../restaurants/undefined` → 404 → the detail check fails, dragging `checks` rate — a data-shape quirk that reads as an SLO/threshold failure. Fix: `const rid = restaurants[i]?.id; if (rid) { ...detail + check... }`.

### L3 — `orderSeed.restaurantId` captured but unused in the POST body
`load-test.js:113` sets `restaurantId`; the POST (`:142`) sends only `{ items:[{itemId,qty}] }`. Verified this matches the real contract (e2e `placeOrder` also sends items-only, header `idempotency-key` — `apps/order-e2e/src/order-saga-happy-path.e2e-spec.ts:96-105`), so the order works and this is harmless dead data. Fix: drop `restaurantId` from the seed, or comment "kept for future multi-restaurant payloads." Observational.

### L4 — empty-catalog order no-op is silent
`load-test.js:137-138`. Correct graceful degradation (order scenario no-ops, browse still loads) — but the only signal that the write path didn't run is the *absence* of order metrics, easy to miss. Fix: `console.warn` in `setup()` when `orderSeed` stays null. Observational.

---

## Confirmed correct (checked, no action)

- **Idempotency-Key uniqueness** (`:73-74`): `k6-${Date.now()}-${__VU}-${__ITER}-${rand(1e9)}`. `__VU` is globally unique across all VUs in a run, `__ITER` is per-VU monotonic, plus ms timestamp + 1e9 random — collision is effectively impossible across VUs/iterations. Orders won't dedupe into one. Adequate.
- **`asArray` robustness** (`:59-70`): `try/catch` around `res.json()`, null-guards before `.data`/`.items`, returns `[]` on anything unexpected. Empty catalog → `orderSeed=null` → order no-ops, never crashes. Handles the verified `{data,total,page,limit}` envelope via the `.data` branch. Sound.
- **`mintToken` failure** (`:92-93`): throws inside `setup()`, which aborts the whole run with a clear `Keycloak token mint failed (status): body` — fails loudly, not silently. Good.
- **Per-scenario tagging for browse/order**: requests carry explicit `scenario` tags matching the auto scenario tag (scenario key), so `{scenario:browse}` / `{scenario:order}` thresholds do apply to the right requests. (Only setup GETs are untagged — L1.)
- **Secret / prod-safety** (README `:7-17,78-79`): verified accurate. Dev realm has `directAccessGrantsEnabled: true` and seeds `customer-user`/`customer-pass` as plaintext non-secret fixtures (`infra/keycloak/realm-export.json:36,162,174`); prod SPA client sets `directAccessGrants: false` (`infra/keycloak/README.md:10`) so this script genuinely cannot ROPC against prod. No committed secrets/tokens. Rate-limit env names (`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_SEC`/`RATE_LIMIT_ENABLED`) verified against `.env.example:32-34` and `infra/k8s/base/gateway/configmap.yaml`. The "not wired into CI" note is reasonable.

---

## Recommended actions (priority order)
1. **H1** — reconcile `http_req_failed` with the 5xx-only alert: either `setResponseCallback(expectedStatuses 200–499)` or reword the "mirrors / would also trip" claims. (Blocking for the SLO-alignment claim.)
2. **M1** — scope latency thresholds per-scenario so the order 1500ms budget is real.
3. **M2 / M3** — scale the arrival-rate VU pool off `ORDER_RATE` (or document the `dropped_iterations` caveat) and document the max `HOLD` vs token lifespan.
4. **L1–L4** — quick hardening: tag setup GETs, guard `browse` element id, drop/annotate unused `restaurantId`, warn on empty-catalog no-op.

## Unresolved questions
- Keycloak access-token lifespan in the dev realm (for M3's documented ceiling) — not read; realm token settings weren't inspected. If it's ≥5m the default+2m runs are safe and M3 is purely a long-run caveat.
- Whether the gateway returns a Keycloak/refresh-friendly 401 vs 403 on expiry (affects whether an optional re-mint-on-401 in M3 is worth it). Low value; skip unless long runs become routine.
