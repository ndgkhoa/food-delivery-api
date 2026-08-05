import { ApiError, type GatewayClient } from './gateway-api-client';

export const ORDER_POLL_ATTEMPTS = 20;
export const ORDER_POLL_DELAY_MS = 1500;
const MAX_RATE_LIMIT_RETRIES = 30;
const RATE_LIMIT_BACKOFF_MS = 2500;

interface OrderStatusResponse {
  status: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isOrderTerminalStatus(status: string): boolean {
  return status === 'CONFIRMED' || status === 'CANCELLED';
}

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
