# Red-Team Review — Slice 5c Gateway Circuit Breaker (opossum, per-downstream)

Branch: `feat/gateway-circuit-breaker` · Reviewed offline (static + opossum 10.0.0 source verification). No code modified.

Files: `circuit-breaker.registry.ts`, `http-forwarder.ts`, 6 `*-proxy.controller.ts`, `gateway-env-schema.ts`, `app.module.ts`.

## Verdict
The breaker contract itself is SOLID: EOPENBREAKER detection is correct against opossum 10, success/failure wiring is right, per-service isolation holds, no lazy-cache race, disabled pass-through is clean, boot can't crash on unset CB_*. The one material defect is a resilience gap that is **not** in the breaker code but in the forwarder's body-read path (a hung-body upstream can hang the gateway forever and is silently counted as a breaker success). Everything the live test exercised (full-down upstream) works.

---

## Findings (ranked)

### HIGH — H1: Response body read runs with NO timeout; a headers-then-stall upstream hangs the gateway forever, and the breaker records it as SUCCESS
`apps/gateway/src/proxy/http-forwarder.ts:80-81, 110-120`

Flow:
1. `timer = setTimeout(() => controller.abort(), 10s)` (line 81).
2. `upstream = await this.breakers.run(...)` — the fired action is `fetch(...)`, which **resolves as soon as response headers arrive** (undici semantics), not when the body is fully read.
3. `finally { clearTimeout(timer) }` (line 111) — the abort timer is cleared the instant headers are received.
4. `res.send(Buffer.from(await upstream.arrayBuffer()))` (line 120) — the **body** is read here, *after* the timer is already cleared and with no other timeout.

Failure scenario: an upstream that returns `200 OK` + headers quickly, then stalls the response body indefinitely (slow-loris body, half-open TCP after headers, a wedged streaming handler). `fetch` resolves → breaker counts a **success** → timer cleared → `arrayBuffer()` awaits a body that never completes. Node `fetch` has no default body-read timeout, so `forward()` **hangs forever**, holding the client socket and the upstream socket open. Because each such call is a breaker *success*, no volume of stalled-body responses will ever open the breaker.

This directly undermines the slice's stated premise ("EVERY request still waits the full 10s timeout … tying up gateway resources"): the 10s AbortController only bounds time-to-headers, not time-to-body, and the breaker provides zero protection because the calls look successful. The live verification only exercised a fully-down upstream (connect-refused → clean reject), so this path is untested.

Note: this is a **pre-existing structural issue** in the forwarder (the refactor preserved the `finally clearTimeout` + later `arrayBuffer` shape), not a regression introduced by the breaker. But per the focus-#2 brief ("any path where the action neither resolves nor rejects → hang") it is a genuine unbounded hang and the slice's resilience goal implies it should be covered.

Fix: keep the abort window alive across the body read. Move the body read inside the timed region and clear the timer only after it completes, e.g.:
```ts
try {
  upstream = await this.breakers.run(target.serviceName, action);
  bodyBuf = Buffer.from(await upstream.arrayBuffer()); // still under the abort signal
} catch (err) { ... /* AbortError mid-body → 504, other → 502 */ }
finally { clearTimeout(timer); }
// relay status + headers + bodyBuf here
```
undici aborts an in-flight body when the fetch signal fires, so a stalled body then rejects with `AbortError` → mapped to 504 instead of hanging. (Body-read failures becoming 502/504 is the correct outcome and does not need to count against the breaker — it's outside `run`.)

### MEDIUM — M2: Body-read rejection is unhandled → error propagates after `res.status()` is set (possible 500 / headers-sent)
`apps/gateway/src/proxy/http-forwarder.ts:114-120`

`res.status(upstream.status)` (114) and the `setHeader` relay loop (115-119) run, then `await upstream.arrayBuffer()` (120) is **outside** any try/catch. If the upstream resets the connection mid-body (common with flaky upstreams — and the exact case H1 leaves un-aborted), `arrayBuffer()` rejects, the rejection escapes `forward()`, and Nest's exception filter tries to send a 500 on a response whose status/headers were already mutated. Best case the client gets a confusing 500 for what was a 2xx; worst case `ERR_HTTP_HEADERS_SENT` if anything flushed. The fix for H1 (wrapping the body read in the try) resolves this too — map the reject to 502.

### MEDIUM — M3: "single half-open probe" is not enforced under concurrency; every reset interval a burst pays the full 10s timeout
`circuit-breaker.registry.ts` (opossum config) + spec §"Open → fail fast"

Verified against opossum 10 `circuit.js`: the open-guard is `if (!this.closed && !this.pendingClose)`. In half-open `pendingClose === true`, so the guard is bypassed and, with the default `capacity` (`Number.MAX_SAFE_INTEGER`, no `capacity` option set here), **all** concurrent requests arriving in the half-open window pass through to the real upstream — not just one probe. If the downstream is still down, each of those requests hits `fetch` and waits the full `FORWARD_TIMEOUT_MS` (10s) before rejecting and reopening the breaker.

Consequence: under sustained load against a still-down service, every `CB_RESET_TIMEOUT_MS` (10s) a burst of requests pays the full 10s timeout instead of fast-failing. Fast-fail holds for the steady open state (the win the slice targets), but the spec/plan wording "a single half-open probe" overstates opossum's actual behavior. Not blocking; document it, or (if a true single-probe is wanted later) that's a known opossum limitation with no clean built-in option (`capacity:1` would also throttle the closed state — do NOT do that).

### LOW — L4: AbortController + timer allocated even when the breaker is open
`apps/gateway/src/proxy/http-forwarder.ts:80-81`

When the breaker is open, `run()` rejects with EOPENBREAKER without firing the action, yet the `AbortController` and `setTimeout` are created first (then cleared in `finally`). Harmless (timer is always cleared) — micro-waste only. Optional: construct them lazily inside the action. Not worth changing on its own.

---

## Confirmed SOLID (focus items that hold up)

- **EOPENBREAKER detection (focus #1).** opossum 10 `buildError('Breaker is open','EOPENBREAKER')` sets `.code='EOPENBREAKER'` on a real `Error`; the open-guard `if (!this.closed && !this.pendingClose)` fires it before any semaphore check. `http-forwarder.ts:92-93` reads `(err as ErrnoException).code === 'EOPENBREAKER'` — exact match. No fallback is registered, so open always rejects (never silently resolves). Half-open rejections do NOT surface as EOPENBREAKER (they run the action and reject with the real network/AbortError → correctly mapped to 502/504). Default `capacity` means no stray `ESEMLOCKED`.
- **timeout:false (focus #2, breaker side).** opossum uses `options.timeout ?? 10000`, so `timeout:false` stays `false` and `if (this.options.timeout)` skips the timer — opossum's timeout is genuinely disabled; the AbortController is the sole timeout. A fully-down/connect-refused or slow-to-headers upstream aborts → action rejects → breaker counts a failure. (The only uncovered sub-path is body-stall — see H1.)
- **Lazy per-service cache race (focus #3).** `breakerFor()` is fully synchronous — `get` → construct → `set` with no `await` between check and store. Node's single-threaded model means two concurrent first `run()` calls cannot interleave inside it, so no duplicate breaker and no duplicate listeners. Listeners (`open`/`halfOpen`/`close`) are attached exactly once at construction, not per fire. `serviceName` is a hardcoded literal in each of the 6 controllers (`catalog/auth/order/search/delivery/media`) — never request-derived, so the Map is bounded and not attacker-influenced.
- **5xx pass-through (focus #4).** `action = () => fetch(...)` resolves for any HTTP status; the forwarder relays `upstream.status` verbatim. No 5xx-as-failure code exists anywhere, so no half-implemented double-counting. A downstream that 500s every request correctly never opens the breaker (per spec).
- **Success/failure wiring (focus #5).** The action has no internal try/catch swallowing errors — a network error or AbortError rejects the returned promise, which is exactly what opossum's `.catch → emit('failure')` records. Resolved response → `emit('success')`. Correct.
- **CB_ENABLED=false pass-through (focus #6).** `run()` returns `action()` directly when disabled — no breaker, no listeners, no infra. Env schema (`gateway-env-schema.ts:65-76`) gives **defaults** for every `CB_*`, so the constructor's `getOrThrow('CB_*')` calls cannot crash boot even when disabled. `CB_ENABLED` uses `enum(['true','false']).transform` (avoids the "false"-is-truthy coercion trap), and the constructor further guards with `enabled !== false && enabled !== 'false'`.
- **503 response correctness (focus #7).** `Retry-After = Math.max(1, Math.round(resetTimeoutMs/1000))` — always ≥1s (verified for sub-second reset values too). Body is a generic `{statusCode:503, message:'Service temporarily unavailable'}` — no host/reason/downstream leak. The open branch `return`s immediately (line 100), so there is no double-write with the normal relay. No `res` write occurs after headers are flushed in the mainline (the only after-status risk is M2's body-read reject).
- **Identity/forwarder regression (focus #8).** Header construction is unchanged and runs for the normal path: fixed `content-type`, correlation-id relay (`CORRELATION_ID_HEADER`), the `idempotency-key` allowlist, and `applyTrustedIdentityHeaders(headers, req.identity)` (client Authorization/identity never copied). Method, 10s timeout, and response-header relay (`SKIP_RESPONSE_HEADERS`) are intact. The refactor only wrapped the existing `fetch` in `registry.run(serviceName, …)`.
- **Shutdown (focus #9).** opossum `shutdown()` clears its reset/warmup timers, removes listeners, and does not throw; `onApplicationShutdown` iterates the Map synchronously with no awaited work — no hang, no unhandled rejection.
- **Isolation & wiring.** 6 distinct `serviceName`s, one breaker each; `CircuitBreakerRegistry` provided in `app.module.ts`. A dead `catalog` cannot touch `order`'s breaker.

---

## Unresolved questions
1. H1/M2: is the current `finally clearTimeout` + post-try `arrayBuffer` shape intended for this slice to leave as-is (pre-existing), or should slice 5c close the body-stall hang since it's the resource-protection slice? Recommend fixing — small, in-region, and the slice's premise implies it.
2. M3: is "single half-open probe" a hard requirement, or is the steady-state fast-fail sufficient? If the former, it needs a design note (opossum has no clean single-probe knob).

**Status:** DONE
**Summary:** Breaker contract is correct and isolation-safe — EOPENBREAKER detection, timeout:false, success/failure wiring, lazy cache (no race), disabled pass-through, 503+Retry-After, and identity forwarding all verified SOLID against opossum 10 source. One real resilience gap: a headers-then-stalled-body upstream hangs the gateway forever and is silently counted as a breaker success because the abort timer is cleared before the body is read (H1, High; M2 double-fault on mid-body reset). Half-open admits >1 probe under concurrency (M3, Medium — spec wording vs opossum reality).
**Ranked findings:** H1 (High — body-read hang, breaker records success), M2 (Medium — unhandled body-read reject after status set), M3 (Medium — half-open not single-probe under load), L4 (Low — needless timer alloc when open).
