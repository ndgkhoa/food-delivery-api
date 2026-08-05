# Red-Team Review — Slice 6a Config Service + config-client (PR-A)

Branch `feat/config-service`. Static gates + config-e2e (6/6) already green — this pass reasons about logic beyond what those cover. No code modified.

## Verdict
No Critical defect. Partial unique indexes, resolution null-coalescing, tenant-from-verified-identity, global-write platform-admin gate, and cross-tenant cache isolation are all **correct/solid**. One **High** (config-client can block the order path despite its never-block contract) and two **Medium** input/contract-validation gaps.

---

## High

### H1 — config-client 3s timeout does NOT cover the response body read → order path can hang
`libs/shared/config-client/src/config-client.ts:15-23, 90-103`

`fetchWithTimeout` clears the abort timer in `finally` the instant `fetch()` resolves (i.e. once response **headers** arrive). The body is read afterward in the caller via `await res.json()` (line 101 / 116) — **outside** any timeout, and the abort signal can no longer fire. `getInt`/`isEnabled` are `await`ed on the order-placement path.

Failure scenario: config service (or an intermediary/proxy) returns `200` + headers, then stalls before/while streaming the JSON body (half-open connection, GC pause, partial outage). `res.json()` awaits indefinitely → `getInt` never resolves → the caller's order request hangs. This defeats the client's entire stated guarantee ("config must never be a hard dependency for a business flow like placing an order") — and it fails exactly during the partial-outage conditions the fallback exists for.

Fix: keep the abort armed until the body is fully consumed — e.g. read+parse inside `fetchWithTimeout` (do `await res.json()` before `clearTimeout`), or wrap the whole fetch+parse in one `AbortController`/`Promise.race` timeout. Then `describeError`/default path already handles the abort.

---

## Medium

### M1 — response value/flag not validated as finite number/boolean before caching+returning
`libs/shared/config-client/src/config-client.ts:101-102, 116-117`

`const body = (await res.json()) as { value: number }` then `return body.value` with no runtime check. `body.value === undefined` (missing key) is handled (→ default). But `null`, `NaN`, or a non-numeric value passes the `value === undefined` guard in `getInt` (line 55), gets `valueCache.set` and returned. A poisoned value then serves every read for that tenant for the full TTL. Same for `isEnabled`/`enabled` (a truthy non-boolean would be cached).

The config service itself always returns a valid integer (resolution throws 404 when absent), so this is **not** reachable through the current service — but config-client is explicitly defined as *the* defensive trust boundary for this hop ("NEVER throw", never-trust). A misrouted `CONFIG_SERVICE_URL`, an intermediary returning a 200 error envelope, or a future service change would silently feed `null`/`NaN` into e.g. delivery-fee math.

Fix: after parse, treat `typeof value !== 'number' || !Number.isFinite(value)` (resp. `typeof enabled !== 'boolean'`) as `undefined` → caller default; never cache it.

### M2 — config value upper bound not enforced at the DTO → 500 instead of 400 on oversized input
`apps/config/src/interface/http/dto/upsert-config-value.request.ts:4-6`, `apps/config/src/domain/config/config-entry.ts:31-38`, `apps/config/src/interface/http/filters/config-exception.filter.ts:19`

DTO validates `@IsInt() @Min(0)` only — no `@Max`. A value above `Number.MAX_SAFE_INTEGER` (e.g. `9e18`, still integer-valued so `@IsInt` passes) reaches the domain, where `assertValidValue` throws a plain `Error('Config value must be between …')`. The exception filter only `@Catch`es the three domain error classes, so this propagates as a generic **500** rather than a 400 for a client input error. Input validation should live at the boundary.

Fix: add `@Max(Number.MAX_SAFE_INTEGER)` to the DTO (matches the domain bound), so bad input is rejected 400 before the handler.

---

## Low / Informational

- **L1** `typeorm-config-entry.repository.ts:39-42` (and feature-flag repo:27) — `upsert` is save-by-id after a find; a concurrent first-write for the same `(tenant_id,key)` correctly hits the partial-unique index (no duplicate — integrity preserved) but surfaces as an unmapped `QueryFailedError` → 500. Rare admin action, acknowledged in the comment. Optional: map unique-violation → 409.
- **L2** `config-cache.ts:48-54` — `evictAllForKey` uses `endsWith(':'+key)`. `assertValidKey` allows `:` in keys (only non-empty + ≤255 enforced), so a global change to key `fee` would also evict tenant entries for key `ns:fee`. Direction is fail-safe (over-eviction → extra refetch, never a stale value), so correctness holds; consider constraining the key charset to avoid needless evictions.
- **L3** `config-entry.mapper.ts:11` — `Number(orm.value)` on a bigint string loses precision above 2^53. Not reachable via the API (writes bounded to MAX_SAFE_INTEGER) but a manual/seed insert of a larger bigint would read back imprecise.
- **L4** `config-client.ts:34-36` doc mentions 204 as a silent no-WARN state, but the service never emits 204 (absent key → 404), and a real 204 would hit `res.json()` on an empty body → throw → WARN + default. Moot given the service contract; tidy the comment.

---

## Confirmed solid (do not re-litigate)
- Migration: both partial unique indexes present and correct — `WHERE tenant_id IS NOT NULL` on `(tenant_id,key)` and `WHERE tenant_id IS NULL` on `(key)` for both tables. Duplicate-global / duplicate-override impossible. (`migrations/1754200000000…:31-53`)
- Resolution: `(tenantEntry ?? globalEntry)?.value` / `?.enabled` — null-coalescing, so a tenant value `0` and a flag `false` correctly win over global and are never treated as a miss. Get-handlers only 404 on `=== undefined`. (`config-resolution.ts:14,22`; `get-config-value.handler.ts:25-28`)
- Authz: writes gated by `RolesGuard` (403 for non-admin, 401 if no verified identity); global write additionally requires `platform-admin` in the handler; **tenant scope derives from the verified context (`getTenantIdOrThrow`), never from a client body/param — no spoofable tenant field**; another tenant's override is unreachable. Reads open to any verified tenant (`x-roles: ''`). (`upsert-config-value.handler.ts:42-48`; `roles.guard.ts`; `trusted-identity.interceptor.ts:46-56`)
- config-client never-throws on the covered paths: 5xx/!ok → throw→caught→default; network error/abort→caught→default; 404→undefined→default; malformed JSON→`res.json()` throws→default; missing `value`→undefined→default. (gaps are H1/M1 only)
- Falsy caching: `cached !== undefined` returns `0`/`false` correctly. (`config-client.ts:49,71`)
- Cross-tenant isolation: cache key `${tenantId}:${key}`, separate value/flag `ConfigCache` instances wired in the module — no cross-tenant or cross-type bleed. (`config-cache.ts:2`; `config-client.module.ts:62-63`)
- Event eviction keys off the **payload** `tenantId` (`null → evictAllForKey`), not the `'global'` header sentinel; `evictAllForKey` never under-evicts the real `:key` entry. (`config-events.ts:32-40`; `config-event.publisher.ts:50`)
- BIGINT→string ORM column + `Number()` mapper avoids precision loss within the enforced write bound; `synchronize:false`. (`config-entry.orm-entity.ts:17-18`; `typeorm-options.ts:33`)

## Unresolved questions
- Is the config service reachable only via the gateway + internal callers on a trusted network? config-client calls the service **directly** and stamps `x-roles`/`x-user-id` itself (read-only — no write method exists on `ConfigClient`), matching the repo-wide gateway-stamped-header trust model. If the config service port is exposed beyond the trusted mesh, direct `x-roles: platform-admin` requests would bypass the gateway — an infra/network-policy concern, out of scope for this diff but worth confirming for PR-B.
