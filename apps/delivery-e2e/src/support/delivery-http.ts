import { applyTrustedIdentityHeaders } from '@food-delivery-api/shared-tenancy';
import { DELIVERY_BASE_URL } from './delivery-e2e-config';

export interface JsonResponse<T> {
  status: number;
  body: T;
}

export async function getDelivery<T>(
  path: string,
  identity: { tenantId: string; userId: string; roles?: string[] },
): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = {};
  applyTrustedIdentityHeaders(headers, {
    sub: identity.userId,
    tenantId: identity.tenantId,
    roles: identity.roles ?? [],
  });
  const response = await fetch(`${DELIVERY_BASE_URL}/api/v1${path}`, { headers });
  const body = (await response.json().catch(() => undefined)) as T;
  return { status: response.status, body };
}

export async function pollUntil<T>(
  fn: () => Promise<T | undefined>,
  { timeoutMs = 15000, intervalMs = 500 } = {},
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return undefined;
}
