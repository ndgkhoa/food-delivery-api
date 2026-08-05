# Slice 6b PR-B — Review Service Red-Team Review

Reviewer: code-reviewer | Date: 260730 | Branch: feat/review-service
Scope: apps/review/**, apps/catalog rating projection, apps/search rating projection, apps/gateway review proxy, migrations 1754150000000 + 1754160000000.
Method: read + reason only (no writes/docker/live-e2e). Static gates + happy-path e2e already green per task; focus is on edges the happy path never exercised (edit-after-review, out-of-order, redelivery, cross-tenant, injection).

## Verdict
One Critical (search-side rating clobber on a normal restaurant edit — the exact bug the catalog side was fixed for, left un-fixed in ES). Everything else in the 7 focus areas is SOLID or Low/informational.

---

## CRITICAL

### C1 — Restaurant edit silently resets ES rating to 0 (search-side clobber analog left open)
File: `apps/search/src/application/restaurant-search/apply-restaurant-search-event.ts:36-52`

The `RestaurantCreated`/`RestaurantUpdated` branch does a full-document `repository.upsert({... rating: 0 ...})`. `rating` is owned by the separate `review.events` path (`updateRating`), but this `catalog.events` upsert unconditionally writes `rating: 0` on EVERY create AND update.

Concrete failure scenario (a routine operation, not an exotic race):
1. Restaurant created → ES doc rating 0.
2. Customer submits 5-star review → `review.events` → `ElasticsearchRestaurantSearchRepository.updateRating` → ES doc rating 5. (Confirmed by the live full-loop e2e.)
3. Restaurant owner edits the restaurant name/description → catalog emits `RestaurantUpdated` on `catalog.events` → search re-upserts the FULL doc → `rating: 0`. **The 5-star rating is silently clobbered back to 0.**
4. It only self-heals if/when a NEW review is submitted (which may never happen). Meanwhile search `function_score` ranking and the returned `rating` field are wrong.

The catalog read-model was explicitly hardened for exactly this (raw-SQL upsert excluding rating/review_count — see C1-analog SOLID note below). The ES side is the missing analog. `external_gte` versioning does NOT protect: the edit's `version` (= updatedAt epoch-millis) is legitimately newer than the create's, so ES accepts the overwrite; and after the review's Update-API call the stored version reverts to a small internal counter, so the epoch-millis edit always wins.

Why the happy-path e2e missed it: the live loop tested create→review→search but never edit-AFTER-review.

Fix (mirror the catalog fix — make the catalog projection stop owning `rating` in ES):
- Change the `RestaurantCreated`/`RestaurantUpdated` write from a full `index` to a scripted `update` with `doc_as_upsert` semantics that sets only catalog-owned fields (name/description/isActive/created/updated) and seeds `rating: 0` ONLY in the `upsert` (insert) body — the script path (existing doc) must not touch `rating`. e.g. ES `update` with `script` (assign catalog fields) + `upsert` (full doc incl rating:0).
- Reconcile with the external-version guard: the create path currently relies on `external_gte`. Simplest is to keep create as an `index` (seeds rating 0) and make ONLY `RestaurantUpdated` a partial/scripted update that omits `rating`. That preserves the version guard on create while never clobbering rating on edit. Add a unit test: upsert(rating 0) → updateRating(5) → apply RestaurantUpdated → assert rating still 5.

Severity rationale: silent loss of correct data on a normal user action, with no self-recovery guarantee — matches the "rating silently clobbered on a normal edit" Critical bar.

---

## MEDIUM

### M1 — First-ever rating dropped if it beats the restaurant projection (both sinks, no reconciliation)
Files: `apps/search/.../elasticsearch-restaurant-search.repository.ts:91-106` (404 → no-op) and `apps/catalog/.../typeorm-read-restaurant.repository.ts:72-79` (`repository.update({id,tenantId},…)` on a not-yet-inserted row affects 0 rows → silent no-op).

If a `RestaurantRatingChanged` is applied before the restaurant's `catalog.events` upsert has projected the row/doc, the rating is silently discarded on BOTH sinks and only re-applied by a SUBSEQUENT review. There is no retry / re-emit / upsert-with-rating reconciliation.

Likelihood: low in this domain — a review requires an eligible (confirmed) order, which requires the restaurant to have existed and been ordered from, so the restaurant was created and projected long before. Real only if the catalog/search projection consumer is lagging/down while the review path races ahead. The ES side is documented as an accepted trade-off; the catalog `update`-no-op is NOT documented and behaves identically — worth a one-line doc + a backlog note to reconcile (e.g. on updateRating-miss, log at warn so a lagging projection is observable). Not blocking.

---

## LOW / INFORMATIONAL

- **L1 — `rating real` float precision.** `read_restaurants.rating` (migration 1754150000000) and the ES field are `real`/float. 2-decimal averages like 4.33 aren't exactly representable (stored ~4.3299999). No current defect — the tested value 5.0 is exact, and rating is a display/ranking value where tolerance is fine. If any future assertion does strict `=== 4.33`, it will flake; prefer `numeric(3,2)` or tolerance-based assertions then.
- **L2 — Multi-relay reordering.** `OutboxRelay` uses `FOR UPDATE SKIP LOCKED`, so running 2+ review relays would let two same-restaurant rating events be claimed by different relays and published concurrently → possible same-partition reorder → an older avg overwriting a newer one (neither `updateRating` has a version guard). Mitigated only by the documented "one relay per service" operational rule. Flag for deployment/runbook; single-relay is correct and in-order (see S5).
- **L3 — `updateRating` ignores tenantId in ES.** `elasticsearch-restaurant-search.repository.ts:91` updates by `_id` only. Safe because `restaurantId` is a globally-unique UUID and the aggregateId is derived from a tenant-scoped eligibility row, so it can't cross tenants — but a `term tenantId` guard would be cheap defense-in-depth.

---

## SOLID (verified, do not re-litigate)

- **Cross-tenant isolation (S-tenant).** `findEligible(tenantId, orderId)` is tenant-scoped (`typeorm-review-eligible-order.repository.ts:38`); another tenant's order → null → `ReviewEligibilityNotFoundError` → 404 (`errors.ts:29`, filter maps NOT_FOUND). Existence never leaks cross-tenant. ✓
- **Ownership (S-authz).** Same-tenant non-owner → `ReviewNotOwnedError` → 403 (`submit-review.handler.ts:65`; filter → FORBIDDEN). restaurantId taken from eligibility record, never client — no forged-restaurant review. ✓
- **One-review-per-order (S-dupe).** `reviews.order_id uuid NOT NULL UNIQUE` (migration 1754160000000:30) is a GLOBAL unique on a globally-unique UUID; 2nd review → 23505 → `DuplicateReviewError` → 409 (`submit-review.handler.ts:96`). ✓
- **Outbox atomicity (S-outbox).** Review insert + `review_outbox` append run in one tx (`submit-review.handler.ts:80-92`; adapter `append` enlists via transactional EM). Event never emitted without a committed review, nor lost. At-least-once; catalog dedupes via `processed_events` in-tx, search is idempotent LWW. ✓
- **Per-restaurant ordering / redelivery (S5).** Event key = `aggregate_id` = restaurantId (`typeorm-review-outbox.adapter.ts:100`; `build-rating-changed-event.ts` doc), single partition. `fetchUnpublished` orders by `created_at ASC` (adapter:90) and a single relay drains sequentially → in-order publish. Redelivery window (publish ok, markPublished crash) re-fetches the SAME unpublished rows in created_at order AHEAD of any newer rows, so a stale-older-avg-after-newer-avg overwrite cannot occur with a single relay. Recompute-from-source makes duplicate delivery a no-op. ✓ (residual risk only under multi-relay — see L2.)
- **Recompute correctness (S3).** `SELECT AVG(rating), COUNT(*) … WHERE restaurant_id=$1 AND tenant_id=$2` (`typeorm-review.repository.ts:54`) — tenant+restaurant scoped, no cross-tenant averaging; runs on the transactional manager so it sees the just-inserted row; rounded `Math.round(avg*100)/100` (2dp). Single 5-star → avg 5 exact, count 1 — matches the e2e assertion, no float drift at that value. ✓
- **Raw-SQL catalog upsert / C1 analog (S7).** `typeorm-read-restaurant.repository.ts:52-65` — fully parameterized ($1–$7, no interpolation), `ON CONFLICT (id)` targets the PK correctly, `DO UPDATE SET` lists only name/description/is_active/updated_at → rating/review_count and created_at/tenant_id preserved on edit; migration gives both rating/review_count `NOT NULL DEFAULT 0` so the omitting INSERT seeds 0 on create. The catalog-side fix is correct. ✓
- **Comment injection/bounds (S6).** DTO `@MaxLength(1000)` + `@IsString` + trim transform (`submit-review.request.ts`); persisted via parameterized TypeORM insert; comment is never projected to ES nor interpolated into any query. Rating VO `Rating.create` (integer 1–5) + DB `CHECK (rating BETWEEN 1 AND 5)` — layered. ✓
- **Eligibility consumer (S-elig).** Idempotent by eventId (`processed_events` + upsert in one tx, `record-review-eligibility.handler.ts:32`); trusts `OrderConfirmed` (gateway-internal); stragglers without restaurantId skipped (`parse-eligible-order.ts:23`). ✓
- **Gateway proxy (S-gw).** `review-proxy.controller.ts` behind global JwtAuthGuard, forwards verified identity as trusted headers, both root + subpath routes covered. Ownership deferred to review service (correct). ✓

---

## Unresolved questions
1. C1 fix direction: confirm the team wants ES `rating` owned solely by `review.events` (scripted-update/partial approach) rather than teaching `catalog.events` to carry rating — the former matches the catalog read-model design and is recommended.
2. M1: is a lagging-projection reconciliation (or at least a warn-log on updateRating-miss) in scope for 6b, or a follow-up backlog item?

**Status:** DONE
**Summary:** 1 Critical — a routine restaurant edit re-upserts the ES doc with `rating: 0` (`apply-restaurant-search-event.ts:48`), silently clobbering a review-set rating with no self-recovery; this is the un-fixed analog of the catalog upsert fix. 1 Medium (first-rating-before-projection dropped on both sinks, no reconciliation), 3 Low (real float precision, multi-relay reorder, ES updateRating tenant guard). Tenant isolation, ownership, one-per-order, outbox atomicity, single-relay ordering/redelivery, recompute correctness, the raw-SQL catalog upsert, and comment/injection handling are all verified SOLID.
