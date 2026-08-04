import { randomUUID } from 'node:crypto';
import type { GatewayClient } from './gateway-api-client';
import type { SeedState } from './seed-state-store';

interface OrderResponse {
  id: string;
}

/**
 * Places the same order body TWICE with the SAME `Idempotency-Key` header —
 * `PlaceOrderHandler` maps the key to the first durable order and replays it
 * rather than starting a second saga (`apps/order/src/application/order/commands/place-order.handler.ts`).
 * Asserts both calls return the identical order id; only the first call's id
 * is tracked for teardown (the second is the same order, not a new one).
 */
export async function runIdempotencyScenario(
  customerGateway: GatewayClient,
  tenantId: string,
  idempotencyItemId: string,
  state: SeedState,
): Promise<void> {
  console.log(
    '\n[scenario] idempotency — placing the same order twice with the same Idempotency-Key...',
  );
  const idempotencyKey = randomUUID();
  const body = { items: [{ itemId: idempotencyItemId, qty: 1 }] };

  const first = await customerGateway.request<OrderResponse>(
    'place idempotency demo order (1st)',
    'POST',
    '/orders',
    body,
    { 'idempotency-key': idempotencyKey },
  );
  state.orders.push({ id: first.id, tenantId });

  const second = await customerGateway.request<OrderResponse>(
    'place idempotency demo order (2nd, replay)',
    'POST',
    '/orders',
    body,
    { 'idempotency-key': idempotencyKey },
  );

  if (second.id === first.id) {
    console.log(
      `  idempotency demo: PASS — replay with the same key returned the same order ${first.id}`,
    );
  } else {
    console.warn(
      `  idempotency demo: FAIL — replay returned a DIFFERENT order (${first.id} vs ${second.id})`,
    );
  }
}
