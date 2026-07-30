import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { buildIdentityHeaders } from './support/build-identity-headers';
import {
  DEFAULT_VAT_RATE_BPS,
  placeOrder,
  seedMenuItem,
  seedStock,
} from './support/saga-e2e-support';

/**
 * Compose-based end-to-end proof that the order total is CONFIG-sourced, not
 * hardcoded: setting a tenant's `order.delivery_fee_cents` via the config
 * service and then placing an order must reflect the new fee in that order's
 * total, no redeploy. Needs the LIVE stack — order AND config (their own
 * Postgres databases, shared core Postgres) — plus `core`+`messaging`:
 *
 *   docker compose -f infra/docker-compose.yml --profile core --profile messaging up -d
 *   pnpm db:migrate                        # catalog/auth/inventory/order/payment/config
 *   pnpm dev                               # gateway/catalog/auth/inventory/order/payment/config
 *   pnpm nx e2e order-e2e --testFile=order-config-pricing.e2e-spec.ts
 *
 * Env: ORDER_BASE_URL (default http://localhost:3003/api/v1), CONFIG_BASE_URL
 * (default http://localhost:3008/api/v1), DB_* (shared core Postgres).
 *
 * Calls the config service DIRECTLY (bypassing the gateway) with a
 * hand-stamped trusted identity, the same approach `config-e2e` uses. VAT
 * rate and discount are left un-set for this fresh tenant, so the assertion
 * also proves the config-client's per-key default fallback (a 404 for an
 * unconfigured key, not an error).
 */
const ORDER_BASE_URL = process.env.ORDER_BASE_URL ?? 'http://localhost:3003/api/v1';
const CONFIG_BASE_URL = process.env.CONFIG_BASE_URL ?? 'http://localhost:3008/api/v1';

interface OrderPricingResponse {
  status: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  vatCents: number;
  discountCents: number;
  totalCents: number;
}

async function getOrder(
  tenantId: string,
  userId: string,
  orderId: string,
): Promise<OrderPricingResponse> {
  const res = await fetch(`${ORDER_BASE_URL}/orders/${orderId}`, {
    headers: buildIdentityHeaders(tenantId, userId),
  });
  return (await res.json()) as OrderPricingResponse;
}

/** Writes the caller tenant's override for `order.delivery_fee_cents` (admin-role write, own tenant only). */
async function setTenantDeliveryFeeCents(tenantId: string, valueCents: number): Promise<void> {
  const res = await fetch(`${CONFIG_BASE_URL}/config/order.delivery_fee_cents`, {
    method: 'PUT',
    headers: {
      ...buildIdentityHeaders(tenantId, `admin-${tenantId.slice(0, 8)}`, ['admin']),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ value: valueCents }),
  });
  if (res.status !== 200) {
    throw new Error(
      `setTenantDeliveryFeeCents: config PUT returned ${res.status} for tenant ${tenantId}`,
    );
  }
}

describe('Order pricing reads config (e2e, compose)', () => {
  it("a tenant's custom delivery fee changes the very next order's total, no redeploy", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    const customFeeCents = 2500;

    await setTenantDeliveryFeeCents(tenantId, customFeeCents);
    await seedMenuItem(tenantId, randomUUID(), itemId, 1200);
    await seedStock(tenantId, itemId, 5);

    const placed = await placeOrder(tenantId, userId, [{ itemId, qty: 2 }]);
    expect(placed.status).toBe('PENDING');

    const order = await getOrder(tenantId, userId, placed.id);
    expect(order.subtotalCents).toBe(2400); // 2 x 1200
    expect(order.deliveryFeeCents).toBe(customFeeCents);
    // vat_rate_bps/discount_cents were never set for this tenant — the
    // documented defaults (10% VAT, 0 discount) resolve via the client's
    // caller-default fallback, not an error.
    const expectedVatCents = Math.floor((order.subtotalCents * DEFAULT_VAT_RATE_BPS) / 10000);
    expect(order.vatCents).toBe(expectedVatCents);
    expect(order.discountCents).toBe(0);
    expect(order.totalCents).toBe(
      order.subtotalCents + order.deliveryFeeCents + order.vatCents - order.discountCents,
    );
  }, 60_000);
});
