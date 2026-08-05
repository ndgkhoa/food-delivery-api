import { CONFIG_VALUES, type MenuItemFixture } from './demo-data-fixtures';

export const SCENARIO_RESTAURANT_NAME = 'Demo Edge Cases';
export const SCENARIO_RESTAURANT_DESCRIPTION =
  'Dedicated menu items driving the saga-compensation, idempotency, and no-oversell demo scenarios (see tools/seed/README.md).';

export const LOW_STOCK_QTY = 3;

function configValue(key: string): number {
  const found = CONFIG_VALUES.find((entry) => entry.key === key);
  if (!found) {
    throw new Error(`demo-data-fixtures.ts CONFIG_VALUES is missing the "${key}" entry`);
  }
  return found.value;
}

export function solveSubtotalForExactTotal(
  targetTotalCents: number,
  deliveryFeeCents: number,
  vatRateBps: number,
  discountCents: number,
): number {
  const approx = Math.round(
    ((targetTotalCents - deliveryFeeCents + discountCents) * 10000) / (10000 + vatRateBps),
  );
  const SEARCH_RADIUS = 5;
  for (
    let candidate = approx - SEARCH_RADIUS;
    candidate <= approx + SEARCH_RADIUS;
    candidate += 1
  ) {
    if (candidate <= 0) continue;
    const vatCents = Math.floor((candidate * vatRateBps) / 10000);
    const totalCents = candidate + deliveryFeeCents + vatCents - discountCents;
    if (totalCents === targetTotalCents) return candidate;
  }
  throw new Error(
    `could not solve a subtotal matching target total ${targetTotalCents} cents ` +
      `(deliveryFee=${deliveryFeeCents}, vatRateBps=${vatRateBps}, discount=${discountCents})`,
  );
}

export interface ScenarioMenuItems {
  compensation: MenuItemFixture;
  idempotency: MenuItemFixture;
  lowStock: MenuItemFixture;
}

export function scenarioMenuItems(paymentStubFailAtCents: number): ScenarioMenuItems {
  const compensationSubtotal = solveSubtotalForExactTotal(
    paymentStubFailAtCents,
    configValue('order.delivery_fee_cents'),
    configValue('order.vat_rate_bps'),
    configValue('order.discount_cents'),
  );
  return {
    compensation: {
      name: 'Saga Compensation Special',
      description: `Priced so a single order totals exactly ${paymentStubFailAtCents} cents — the payment stub's configured decline amount.`,
      priceCents: compensationSubtotal,
      stockQty: 20,
    },
    idempotency: {
      name: 'Idempotency Demo Bowl',
      description: 'Ordinary item used to demo Idempotency-Key replay (same key, same order).',
      priceCents: 4999,
      stockQty: 20,
    },
    lowStock: {
      name: 'Low Stock Flash Item',
      description: `Seeded with only ${LOW_STOCK_QTY} units to demo no-oversell concurrency.`,
      priceCents: 3000,
      stockQty: LOW_STOCK_QTY,
    },
  };
}
