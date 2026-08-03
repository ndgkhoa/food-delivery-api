# Red-Team Review — Slice 6a PR-B: Order Config-Sourced Pricing

Branch `feat/order-config-pricing` (uncommitted worktree; `develop`==`HEAD`). Diff read from working tree.
Scope: money math (`order.ts`), migration, config integration, persistence, saga. Read-only.

## Verdict

Money arithmetic is correct for in-range inputs. One **High** contract/overflow gap where the
config service accepts component values (up to `MAX_SAFE_INTEGER`) that the order's int4 columns
and total-only guard cannot hold — surfaces as a tenant-wide placement outage / raw 500, not as
silently-wrong money. One **Medium** business-decision (over-discount → silent free order). Two Low.
The live e2e (5140 total, saga, compensation, migration) is confirmed and not re-litigated.

---

## HIGH — MAX_MONEY_CENTS guard bounds only `totalCents`; individual components can overflow int4

Files: `apps/order/src/domain/order/order.ts:96-100`, `order-item.ts:31`,
`infrastructure/persistence/entities/order.orm-entity.ts:37-50` (all `integer`/int4),
`apps/config/src/interface/http/dto/upsert-config-value.request.ts:1-11` (`@Min(0) @Max(Number.MAX_SAFE_INTEGER)`).

`Order.create` validates each pricing field only as *non-negative integer* (`order.ts:59-69`, no
upper bound) and guards **only the final `totalCents`** against `MAX_MONEY_CENTS` (2_147_483_647 =
int4 max). But `subtotal_cents`/`delivery_fee_cents`/`vat_cents`/`discount_cents` are each persisted
to their own int4 column. The config write-DTO permits any value in `[0, 9_007_199_254_740_991]` —
~4.2M× larger than int4 — so an admin write the config service explicitly accepts can produce a
component that overflows its column while `totalCents` stays in range.

**Scenario B (masked overflow → uncaught 500 + outage).** Config `order.delivery_fee_cents =
3_000_000_000` and `order.discount_cents = 3_000_000_000` (both valid per the DTO). Order subtotal
2400, default VAT 1000bps → vat 240.
`total = max(0, 2400 + 3e9 + 240 − 3e9) = 2640` ≤ `MAX_MONEY_CENTS` → guard passes;
`assertValidPricingInput` passes (both non-neg ints). `Order.create` **succeeds** with
`deliveryFeeCents = 3e9`. On INSERT, `delivery_fee_cents` (3e9 > int4 max) → Postgres SQLSTATE
`22003` integer-out-of-range → `QueryFailedError`. `PlaceOrderHandler` only catches unique_violation
(`place-order.handler.ts:155-166`) and rethrows; `OrderDomainErrorFilter`
(`interface/http/filters/order-domain-error.filter.ts:48-57`) does not catch `QueryFailedError` →
falls through to Nest default → **HTTP 500**. Every order placement for that tenant 500s until config
is corrected. The domain's `MAX_MONEY_CENTS` invariant is *bypassed* and the failure surfaces as a
raw DB error deep inside the idempotency+order+saga+outbox transaction (full rollback each time).

**Scenario A (unmasked → misleading 400).** Same big fee, discount 0 →
`total = 3_000_002_640 > MAX_MONEY_CENTS` → `InvalidOrderRequestError` → HTTP **400** (see Low-1:
wrong attribution). Cleaner than B but still a tenant-wide placement outage from a valid config write.

**VAT precision-loss (focus #1) is backstopped, not exploitable.**
`vatCents = floor(subtotal*vatRateBps/10000)`; `subtotal` is *not* bounded before the multiply. But
precision loss requires `subtotal*vatRateBps > 9.007e15`, which forces `vat > ~9e11` — far above both
int4 and `MAX_MONEY_CENTS`. Any such order is therefore rejected (clean 400 if total overflows, or
scenario-B 500 if a large discount masks it). No precision-loss magnitude can produce a *persisted*
order with a silently-wrong VAT. Same for a giant item-count subtotal: capped per line
(`order-item.ts:46`), and an oversized sum trips the total guard on the customer path (customers
can't set discount, so customers only ever hit the clean 400 — scenario B needs the admin discount).

**Fix.** Add per-component upper bounds in `Order.create` *before* persist — assert
`subtotalCents`, `deliveryFeeCents`, `vatCents`, `discountCents` each `<= MAX_MONEY_CENTS` (throw
`InvalidOrderRequestError`). Converts scenario B's raw 500 into a clean domain error and closes the
guard bypass. Defense-in-depth even if a per-key config bound is later added. (Optionally also clamp
`subtotal` before the VAT multiply, but the component-bound assert already covers it.)

---

## MEDIUM (business decision) — Over-discount silently floors total to 0 → free order charged 0

File: `apps/order/src/domain/order/order.ts:97`.

`total = max(0, subtotal + fee + vat − discount)`. The floor correctly prevents a *negative* charge
(you never pay the customer), and the comment states this is intended. But it makes no distinction
between "legitimately free" and "discount silently swallowed the whole order." Config
`order.discount_cents = 10_000` ($100), order subtotal 2000, fee 1500, vat 200 →
`total = max(0, −6300) = 0`. Order persists `totalCents = 0`; the saga's `ChargePayment` carries 0
(`handle-inventory-reply.handler.ts:79`) → payment charges nothing. A misconfigured / over-aggressive
fixed-cents promo yields free orders with **no WARN, no flag, no rejection**.

Per review-audit rules this reverses an *intended* design (floor-at-0), so it is presented as a
business decision, not auto-recommended:
- (a) **Accept** as intended (fixed-cents discount can legitimately zero a small order), or
- (b) **Guardrail**: when `discount >= subtotal + fee + vat`, emit a WARN / mark the order (so a
  runaway config surfaces in logs/metrics instead of silently issuing free orders).

Recommend (b) as low-cost observability. Needs your call on whether a $0 order is ever acceptable.

---

## LOW-1 — `InvalidOrderRequestError` for total>MAX returns 400 (blames the client for a config fault)

File: `order.ts:98-99` → filter default branch `order-domain-error.filter.ts:38-39` = 400.
When an *admin/config* value pushes the total over `MAX_MONEY_CENTS`, the placing client (who did
nothing wrong and cannot fix it) gets a 400 as if the request were malformed. Misleading status +
attribution. Consider a distinct error/status (or at least a message that names config as the cause)
so on-call doesn't chase a phantom client bug. Folds naturally into the HIGH fix.

## LOW-2 — Migration lock/ordering on a large `orders` table

File: `migrations/1753748000000-add-order-pricing-columns.ts`.
Correctness is SOLID: `ADD COLUMN ... DEFAULT 0` is a metadata-only op (PG 11+), the backfill
`subtotal=total` keeps the invariant `total = subtotal + 0 + 0 − 0` for old rows, and `down()` drops
the columns cleanly (CHECKs cascade). Two operational notes for scale/zero-downtime (Low now — early
project, small tables):
1. The whole migration runs in one TypeORM transaction: the full-table `UPDATE` + the four
   `ADD CONSTRAINT CHECK` (each validates via a full scan) hold `ACCESS EXCLUSIVE` on `orders` until
   commit → blocks all reads/writes for the duration on a large table.
2. `DROP DEFAULT` before the new code deploys means any *old-code* insert in that window (no value
   for the now-defaultless NOT NULL columns) would fail. Fine if migration+deploy are coupled; a risk
   under staggered zero-downtime rollout.

---

## Confirmed SOLID (not re-litigated beyond logic check)

- **config never blocks order (focus #5).** `resolvePricing` uses `Promise.all`
  (`place-order.handler.ts:205-209`) — the 3 reads are **parallel**, so worst case is ~one 3s
  `FETCH_TIMEOUT_MS` (`config-client.ts:11`), not 9s sequential. `getInt` never throws (cold-miss +
  service-down → WARN + caller default; 404 → silent default; body-read timed under one abort at
  `config-client.ts:25-43`). Read-through cache TTL 30s (`order-env-schema.ts:29`) so only cold/expired
  reads hit HTTP. A config outage cannot fail or unboundedly stall placement.
- **Pricing input validation (focus #6).** Negative / non-integer / NaN pricing rejected by
  `assertNonNegativeIntegerPricingField` (`order.ts:59-63`) *before* compute. Config-client also
  rejects non-finite (`config-client.ts:119`) and the write-DTO rejects negatives/floats/>MAX_SAFE_INT
  — defense in depth holds. (Gap is only the *upper* bound → the HIGH finding.)
- **Persistence round-trip (focus #7).** `reconstitute` (`order.ts:121-123`) + `OrderMapper.toDomain`
  (`order.mapper.ts:7-30`) carry all 4 stored columns verbatim — no recompute on read, zero drift risk
  between stored `total` and a rehydrated order.
- **Saga total (focus #8).** `ChargePayment` carries `order.totalCents`
  (`handle-inventory-reply.handler.ts:79`); confirm/cancel lifecycle events also use `totalCents`
  (`saga-commands.ts:95-129`, `handle-payment-reply.handler.ts:76`). Nothing downstream treats
  `total == subtotal`; inventory reserve/release keys on item qty, not amount. Consistent end to end.
- **Migration data invariant.** Old rows satisfy `total = subtotal` post-backfill; invariant intact.

---

## Unresolved questions

1. Free-order-via-discount (MEDIUM): accept the floor-at-0 as intended, or add the over-discount
   WARN/flag? Business call.
2. Should a per-key config upper bound (e.g., cap `order.*_cents`/`vat_rate_bps` at `MAX_MONEY_CENTS`)
   be added on the config **write** side in addition to the domain-side component assert, or is the
   domain assert alone (the HIGH fix) sufficient? (Domain assert is enough to close the defect; the
   config bound would give admins a clean 400 at write time instead of at placement time.)
