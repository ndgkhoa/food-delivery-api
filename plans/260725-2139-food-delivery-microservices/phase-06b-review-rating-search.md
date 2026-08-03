# Slice 6b — Review → restaurant rating → search ranking

Context: [phase-06.md](./phase-06-analytics-review-config.md) · [phase-04a.md](./phase-04a-search-elasticsearch.md) · [phase-03b.md](./phase-03b-catalog-outbox-cqrs.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P2 — second P6 slice (after 6a config #21/#22). Closes the loop with P4 search.
- **Status**: ✅ Done — PR-A (order `restaurantId`) #23 · PR-B (review service → rating → search/catalog) #24. Both verified live + adversarially reviewed (search rating-clobber C1 fixed) → merged. **PR-A detail**: order carries `restaurantId` (place-order rejects a multi-restaurant cart with `InvalidOrderRequestError`; nullable migration applied; `OrderConfirmed` carries it, omitted for straggler pre-invariant orders). order-e2e place-cancel **4/4** (in-process: PENDING restaurantId + multi-restaurant 400) + saga happy-path **2/2** (CONFIRMED carries restaurantId + no-oversell) + order unit **71** + all offline gates. Self-reviewed (single-restaurant assertion, omit-logic, additive-safe for delivery/notification consumers). **PR-B ✅ implemented, offline gates green**: new `apps/review` service (HTTP+Postgres+Kafka outbox/relay, mirrors order's outbox pattern) + `order.events` eligibility consumer + `POST /reviews` (403/404/409/400 error mapping) + `RestaurantRatingChanged` (keyed by restaurantId, recompute-from-source, 2-decimal avg) → catalog read-model `rating`/`review_count` columns + new `review.events` projector (kept separate from `catalog.events`'s upsert to avoid clobbering rating) + search ES partial `rating` update via a new `review.events` consumer + gateway proxy. review unit **26**, catalog **52**, search **20**, gateway **30** — all pass; tsc/biome/depcruise/knip all clean. **Verified live (adversarial review in progress)**: review-submit e2e **4/4** (submit → reviews row + rating event · duplicate → 409 · non-owner → 403 · no-eligibility → 404); **full loop 1/1** — create restaurant (catalog→Debezium→ES) → confirm order → 5-star review → recompute → outbox → `review.events` → **search ES rating=5** AND **catalog read-model rating=5/count=1** (DB-confirmed). **Env note**: the Debezium catalog-outbox connector needed re-registration (`infra/debezium/register-connectors.sh`) after the compose restart before catalog→ES worked (known gotcha, not code).
- **Adversarial review + fix applied** (report `reports/code-reviewer-260730-0914-slice-6b-review-service-red-team-review-report.md`; all other focus areas SOLID — cross-tenant isolation/404-no-leak, ownership 403, one-per-order 409, outbox atomicity, per-restaurant ordering, recompute AVG in-tx, raw-SQL catalog upsert, comment bounds):
  - **C1 (Critical)** — the search-side analog of the catalog clobber: search's `catalog.events` handler did a full `index` with `rating: 0`, so a routine restaurant EDIT (RestaurantUpdated) silently reset the ES rating back to 0 (only self-healing on the next review). The catalog DB side was fixed; search wasn't. **Fixed**: `upsert` is now a partial ES `update` — `doc` (no `rating`) merges into an existing doc (preserving the review-sourced rating), `upsert` seeds `rating: 0` on first insert. Regression-locked with an **edit-after-review** e2e step (rename a 5-star restaurant → rating stays 5), verified live.
  - Deferred (documented): M1 (first rating dropped if it beats the projection — a review implies the restaurant existed long before, so near-impossible; ES/catalog both no-op), L1 (float 2dp), L2 (single-relay-per-service ordering — ops note), L3 (ES updateRating tenant defense-in-depth). Search-side `external_gte` dropped on the create/update path (Update API limitation) — per-restaurant Kafka ordering is the primary guard, as it already is for `updateRating`.
- **Completes 6b.** Verified live after the fix: search-rating loop + edit-after-review **1/1**, submit **4/4**, catalog read-model DB-confirmed.
- **Delivery = TWO PRs** (a prerequisite order change kept separate from the new service):
  - **PR-A**: `order` carries `restaurantId` — an order is placed for ONE restaurant; place-order enforces single-restaurant (all items share a restaurant, already resolved per-item via the catalog gRPC gateway) and stores it; `OrderConfirmed` carries `restaurantId`. Enables review-eligibility to know WHICH restaurant an order was for.
  - **PR-B**: new `review` service — submit a review (one per delivered/CONFIRMED order per user), emit `review.events`; a recompute consumer folds ratings into a restaurant average and emits `RestaurantRatingChanged`; `search` fills its ALREADY-wired `rating` field (function_score `log1p(rating)` boost, currently hardcoded 0) and `catalog`'s read model gains a rating field.
- **Brief**: A customer rates a restaurant after a delivered order; the running average recomputes and flows to Elasticsearch so higher-rated restaurants rank/filter better — the search side is already built (4a left `rating: 0` "arrives with review events in a later slice"), so 6b supplies the real signal.

## Key decisions
- **Search is already rating-aware** (`apps/search/.../restaurant-search-query-builder.ts` function_score + `apply-restaurant-search-event.ts:45` `rating: 0` placeholder). 6b only needs to DELIVER a real rating to search — no query change. Propagate via a `RestaurantRatingChanged` event search consumes (either a new type on `catalog.events`, or a `review.events` type search also subscribes to — decide in PR-B; prefer routing through catalog's read-model projector so catalog stays the restaurant source of truth).
- **One review per delivered order** (anti-spam, the plan's rule): eligibility = a CONFIRMED order owned by the caller, not yet reviewed. The `review` service consumes `order.events` `OrderConfirmed` (now carrying `restaurantId` from PR-A) to record `{orderId, userId, restaurantId, tenantId}` as review-eligible; submit validates against that record + a unique `(order_id)` review.
- **restaurantId on the order** (PR-A): the order aggregate gains `restaurantId`; place-order asserts every resolved item belongs to the SAME restaurant (reject a cross-restaurant cart with `InvalidOrderRequestError`) and stores it. Migration adds a NULLABLE `restaurant_id` (existing pre-6b orders have none — they predate reviews; NULL is correct, not backfillable). `OrderConfirmed` payload += `restaurantId`. `OrderCancelled` unchanged (no review path). Saga contract otherwise unchanged.
- **Rating recompute** is idempotent from the event stream: keep a per-restaurant running aggregate (sum + count, or recompute avg from the reviews table) so a redelivered review event doesn't double-count — dedupe by review event id (`IdempotentConsumer`) and/or recompute from the source table. `avg` stored as an integer (e.g. rating×100 or millis) to keep ES + catalog integer-clean, or a float — pick one, document.
- **Review scale**: ratings are 1–5 integers; a `comment` is optional bounded text. Reviews tenant-scoped. No media on reviews yet (P6 review images are a later note in phase-06).
- **`review` service** is a new HTTP + Postgres app (own `review` DB) mirroring catalog; it also runs the `order.events` eligibility consumer + the `review.events` recompute consumer (or the recompute lives in catalog's projector — decide in PR-B).

## Requirements
**PR-A**: place-order rejects a multi-restaurant cart; the order persists `restaurantId`; `OrderConfirmed` carries it; the saga still drives PENDING→CONFIRMED/CANCELLED unchanged.
**PR-B**: `POST /api/v1/reviews {orderId, rating(1..5), comment?}` — auth, one per CONFIRMED order the caller owns; persist + emit `review.events`; the recompute updates the restaurant average and propagates it to the catalog read model + the ES `rating` field so search ranks by it.
**Non-functional**: recompute idempotent (redelivered review event = no double count); rating propagation eventually-consistent (seconds); review submit rejects a non-owner / non-CONFIRMED / already-reviewed / cross-tenant order; search ranking demonstrably shifts with a new rating.

## Architecture / data flow
```
PR-A: place-order ─ resolve items via catalog gRPC (restaurantId per item)
        └─ assert one restaurant → Order(restaurantId) ─ saga ─▶ OrderConfirmed{..., restaurantId}

PR-B:
order.events OrderConfirmed{orderId,userId,restaurantId} ─▶ review: record review-eligible
client ─POST /reviews{orderId,rating,comment}─▶ review: validate eligible + one-per-order → persist
        └─ emit review.events ReviewSubmitted{restaurantId, rating}
review.events ─▶ recompute avg(restaurant) ─▶ RestaurantRatingChanged{restaurantId, avgRating, count}
        ├─▶ catalog read model: restaurant.rating updated
        └─▶ search: ES doc rating field updated (function_score already boosts by it)
```

## Related code files
**PR-A — modify `order`:**
- `domain/order/order.ts` (+ `restaurantId` on props/create; single-restaurant assertion), `order.orm-entity.ts` + `order.mapper.ts`, migration `*-add-order-restaurant-id.ts` (nullable), `application/order/commands/place-order.handler.ts` (derive + assert single restaurant from the catalog-resolved items), `application/saga/saga-commands.ts` (`OrderConfirmed` payload += restaurantId) + the confirm handler, `OrderLifecyclePayload` type. Update order-e2e + saga specs.

**PR-B — create `apps/review/`** (HTTP + Postgres, mirror catalog): env schema (:3009), domain (`Review` model, repository, rating value object 1–5), application (submit-review, eligibility recorder, recompute), infrastructure (persistence: `reviews` + `review_eligible_orders` + `processed_events`; messaging: `order.events` consumer + `review.events` publisher + recompute consumer), interface (`review.controller.ts` POST/GET + DTOs, tenant+auth).
- `apps/catalog/*` — read-model `restaurant.rating` field + projector handles `RestaurantRatingChanged`.
- `apps/search/*` — consume the rating change → update the ES `rating` field (replace the hardcoded 0 in `apply-restaurant-search-event.ts`).
- `infra/*` — `review` DB init, `.env.example`, gateway proxy `/api/v1/reviews/*` (+ breaker serviceName 'review'). Migrations for `reviews`.
- e2e: submit a rating → restaurant average changes → search ranks/filters by it (against live ES).

## Implementation steps
1. **PR-A**: order `restaurantId` (single-restaurant assertion + column + `OrderConfirmed` payload); update saga/e2e; verify the saga still confirms/cancels + the pricing e2e still passes; PR-A.
2. **(after A merges) PR-B**: `review` service scaffold + `reviews` migration.
3. eligibility consumer on `order.events` OrderConfirmed → `review_eligible_orders`.
4. submit-review (one per order, owner + CONFIRMED) → persist → emit `review.events`.
5. recompute consumer → restaurant average → emit `RestaurantRatingChanged`.
6. catalog read model rating field + projector; search consumes the change → ES rating field (replace hardcoded 0).
7. gateway proxy + compose/db-init/.env; e2e: rating → search ranking shift.
8. Update plan before push; PR-B.

## Todo (PR-A)
- [x] order gains `restaurantId` (single-restaurant assertion in place-order) + migration (nullable) + mapper/entity
- [x] `OrderConfirmed` payload carries `restaurantId`; saga + `OrderLifecyclePayload` updated
- [x] order unit + e2e (saga still confirms/cancels; multi-restaurant cart rejected); gates; PR-A

## Todo (PR-B)
- [x] `apps/review` scaffold (HTTP + Postgres) + `reviews`/`review_eligible_orders`/`review_outbox`/`processed_events` migration
- [x] `order.events` eligibility consumer; submit-review (one-per-CONFIRMED-order, owner, tenant) + `review.events` emit (outbox + relay, keyed by restaurantId)
- [x] recompute (in submit-review's own transaction, recompute-from-source) → restaurant average → `RestaurantRatingChanged`
- [x] catalog read-model rating field + projector; search ES `rating` fed real value (replace hardcoded 0 as the initial value)
- [x] gateway proxy `/api/v1/reviews/*` (+ breaker) + db-init/.env (compose has no app-service entries — apps run via `pnpm dev`, unchanged pattern)
- [x] E2E: submit rating → restaurant avg changes → search ranks/filters by rating; one-review-per-order + non-owner rejection — specs written (`apps/review-e2e`, gated `RUN_REVIEW_E2E`/`RUN_REVIEW_SEARCH_E2E`), **needs live verification** (not run by the implementer per environment constraints)
- [x] biome/cruiser/knip/tsc + unit tests; plan updated before push

## Success criteria
- A customer submits a 1–5 rating for a delivered (CONFIRMED) order exactly once; a second attempt on the same order is rejected; a non-owner or non-CONFIRMED order is rejected.
- The restaurant's average rating recomputes idempotently and, within seconds, a higher-rated restaurant ranks/filters higher in `search`.
- Reviews are tenant-scoped; no cross-tenant review or rating leakage.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Cross-restaurant cart has no single restaurantId | M×M | place-order asserts one restaurant (reject otherwise); documented — carts are single-restaurant by design |
| Rating recompute double-counts on redelivery | M×H | `IdempotentConsumer` dedupe by review event id + recompute from the source table (not incremental drift) |
| Old orders (pre-6b) have NULL restaurantId | L×L | Not reviewable (they predate reviews); NULL is correct, review eligibility only from new OrderConfirmed |
| Rating propagation lag to ES | M×L | Eventually-consistent (seconds); acceptable, documented |
| Review spam / fraud | M×M | One per CONFIRMED order owned by the caller; order→restaurant binding via PR-A (not client-supplied) |

## Security considerations
- Submit requires the verified identity; the order must be the caller's own + CONFIRMED (from the eligibility record, not client claims). restaurantId comes from the order (PR-A), never the client — no forging a review for an arbitrary restaurant.
- Reviews + ratings tenant-scoped end to end (eligibility, reviews table, recompute, ES doc, catalog read model).
- Rating is bounded 1–5; comment length-bounded + treated as untrusted text (no injection into ES query).

## Next steps
6c analytics (ClickHouse dashboards). Review images (P6 note) reuse the media presigned-upload path. Rating feeds future ranking/personalisation.
