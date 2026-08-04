import { randomUUID } from 'node:crypto';
import type { GatewayClient } from './gateway-api-client';
import { isOrderTerminalStatus, pollOrderStatus } from './order-status-poller';
import type { SeedState } from './seed-state-store';

interface OrderResponse {
  id: string;
}

/**
 * Places one order for the dedicated "Saga Compensation Special" item (priced
 * so its total exactly matches `PAYMENT_STUB_FAIL_AT_CENTS`), then polls until
 * the saga compensates it: `POST /orders` → STARTED → StockReserved (RESERVED)
 * → payment stub declines → COMPENSATING → StockReleased → CANCELLED (see
 * `apps/order/src/application/saga/handle-payment-reply.handler.ts`). A
 * reviewer can observe this in Bruno with `GET /orders/:id` on the logged id.
 */
export async function runSagaCompensationScenario(
  customerGateway: GatewayClient,
  tenantId: string,
  compensationItemId: string,
  state: SeedState,
): Promise<void> {
  console.log(
    '\n[scenario] saga compensation — placing an order priced to trigger a declined payment...',
  );
  const order = await customerGateway.request<OrderResponse>(
    'place saga-compensation demo order',
    'POST',
    '/orders',
    { items: [{ itemId: compensationItemId, qty: 1 }] },
    { 'idempotency-key': randomUUID() },
  );
  state.orders.push({ id: order.id, tenantId });

  const status = await pollOrderStatus(customerGateway, order.id, isOrderTerminalStatus);
  if (status === 'CANCELLED') {
    console.log(
      `  compensation demo: order ${order.id} CANCELLED (payment declined, stock released)`,
    );
  } else {
    console.warn(
      `  ! compensation demo: order ${order.id} ended in unexpected status "${status}" (expected CANCELLED)`,
    );
  }
}
