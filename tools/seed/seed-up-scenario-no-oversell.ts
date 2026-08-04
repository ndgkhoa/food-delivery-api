import { randomUUID } from 'node:crypto';
import { describeError, type GatewayClient } from './gateway-api-client';
import { isOrderTerminalStatus, pollOrderStatus } from './order-status-poller';
import type { SeedState } from './seed-state-store';

interface OrderResponse {
  id: string;
}

/** Concurrent order count — deliberately more than the seeded stock (`LOW_STOCK_QTY` in `seed-scenario-fixtures.ts`) to exercise the no-oversell guarantee. */
export const NO_OVERSELL_CONCURRENCY = 8;

/**
 * Fires `NO_OVERSELL_CONCURRENCY` concurrent `POST /orders` (1 unit each,
 * distinct `Idempotency-Key`s) against an item seeded with far less stock,
 * via `Promise.allSettled` (a placement failure never aborts the others).
 * Every successfully placed order is polled to a terminal status; the
 * inventory service's atomic conditional decrement
 * (`apps/inventory/src/application/reservation/commands/reserve-stock.handler.ts`)
 * guarantees the CONFIRMED count can never exceed the seeded stock.
 */
export async function runNoOversellScenario(
  customerGateway: GatewayClient,
  tenantId: string,
  lowStockItemId: string,
  seededStockQty: number,
  state: SeedState,
): Promise<void> {
  console.log(
    `\n[scenario] no-oversell concurrency — firing ${NO_OVERSELL_CONCURRENCY} concurrent orders for ${seededStockQty} unit(s) of stock...`,
  );

  const placements = await Promise.allSettled(
    Array.from({ length: NO_OVERSELL_CONCURRENCY }, (_, index) =>
      customerGateway.request<OrderResponse>(
        `place no-oversell demo order #${index + 1}`,
        'POST',
        '/orders',
        { items: [{ itemId: lowStockItemId, qty: 1 }] },
        { 'idempotency-key': randomUUID() },
      ),
    ),
  );

  const orderIds: string[] = [];
  for (const [index, result] of placements.entries()) {
    if (result.status === 'fulfilled') {
      orderIds.push(result.value.id);
      state.orders.push({ id: result.value.id, tenantId });
    } else {
      console.warn(`  ! order #${index + 1} failed to place: ${describeError(result.reason)}`);
    }
  }

  const statuses = await Promise.all(
    orderIds.map((orderId) => pollOrderStatus(customerGateway, orderId, isOrderTerminalStatus)),
  );
  const confirmedCount = statuses.filter((status) => status === 'CONFIRMED').length;
  const otherCount = statuses.length - confirmedCount;
  console.log(
    `  no-oversell demo: ${confirmedCount} CONFIRMED / ${otherCount} CANCELLED-or-other ` +
      `(of ${orderIds.length} placed, seeded stock=${seededStockQty})`,
  );
  if (confirmedCount === seededStockQty) {
    console.log('  no-oversell demo: PASS — confirmed count matches seeded stock, never oversold');
  } else {
    console.warn(
      `  ! no-oversell demo: expected exactly ${seededStockQty} CONFIRMED, got ${confirmedCount}`,
    );
  }
}
