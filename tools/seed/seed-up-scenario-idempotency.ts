import { randomUUID } from 'node:crypto';
import type { GatewayClient } from './gateway-api-client';
import type { SeedState } from './seed-state-store';

interface OrderResponse {
  id: string;
}

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
