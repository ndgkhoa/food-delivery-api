import { ApiError, type GatewayClient } from './gateway-api-client';

export const ORDER_POLL_ATTEMPTS = 20;
export const ORDER_POLL_DELAY_MS = 1500;
/** Max consecutive 429s to ride out before giving up — the gateway's per-identity
 *  rate limit can trip when a burst scenario (no-oversell) polls many orders fast. */
const MAX_RATE_LIMIT_RETRIES = 30;
const RATE_LIMIT_BACKOFF_MS = 2500;

interface OrderStatusResponse {
  status: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Terminal order statuses per the order state machine (`apps/order/src/domain/order/order.ts`) — CONFIRMED/CANCELLED never transition further. */
export function isOrderTerminalStatus(status: string): boolean {
  return status === 'CONFIRMED' || status === 'CANCELLED';
}

/**
 * Polls `GET /orders/:id` until `isTerminal(status)` or the attempt budget is
 * spent — the saga confirms/cancels asynchronously via Kafka, so a freshly
 * placed order is PENDING/RESERVED for a short window after placement.
 * Returns the last observed status either way (never throws on a timeout —
 * callers decide whether that counts as a failure). Shared by every scenario
 * that needs to observe a saga reach its terminal state (compensation,
 * idempotency replay, no-oversell concurrency, and the original review flow).
 */
export async function pollOrderStatus(
  gateway: GatewayClient,
  orderId: string,
  isTerminal: (status: string) => boolean,
  attempts: number = ORDER_POLL_ATTEMPTS,
  delayMs: number = ORDER_POLL_DELAY_MS,
): Promise<string> {
  let lastStatus = 'UNKNOWN';
  let rateLimitRetries = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let order: OrderStatusResponse;
    try {
      order = await gateway.request<OrderStatusResponse>(
        `poll order ${orderId} status (attempt ${attempt})`,
        'GET',
        `/orders/${orderId}`,
      );
    } catch (error) {
      // A 429 means the per-identity rate limit tripped — back off and retry the
      // SAME attempt (don't burn the terminal-wait budget) until the window clears.
      if (error instanceof ApiError && error.status === 429) {
        rateLimitRetries += 1;
        if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) throw error;
        attempt -= 1;
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      throw error;
    }
    lastStatus = order.status;
    if (isTerminal(order.status)) return order.status;
    await sleep(delayMs);
  }
  return lastStatus;
}
