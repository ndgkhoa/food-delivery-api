import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { buildIdentityHeaders } from './support/build-identity-headers';
import {
  DEFAULT_VAT_RATE_BPS,
  placeOrder,
  seedMenuItem,
  seedStock,
} from './support/saga-e2e-support';

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
    expect(order.subtotalCents).toBe(2400);
    expect(order.deliveryFeeCents).toBe(customFeeCents);
    const expectedVatCents = Math.floor((order.subtotalCents * DEFAULT_VAT_RATE_BPS) / 10000);
    expect(order.vatCents).toBe(expectedVatCents);
    expect(order.discountCents).toBe(0);
    expect(order.totalCents).toBe(
      order.subtotalCents + order.deliveryFeeCents + order.vatCents - order.discountCents,
    );
  }, 60_000);
});
