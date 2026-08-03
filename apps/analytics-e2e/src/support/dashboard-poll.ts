const BASE_URL = process.env.ANALYTICS_BASE_URL ?? 'http://localhost:3010/api/v1';

/** Response shapes mirroring apps/analytics/src/interface/http/dto/*.response.ts. */
export interface RevenuePoint {
  day: string;
  revenueCents: number;
  orderCount: number;
}
export interface TopRestaurantEntry {
  restaurantId: string;
  revenueCents: number;
  orderCount: number;
}
export interface Summary {
  revenueCents: number;
  confirmedCount: number;
  cancelledCount: number;
}

function tenantHeaders(tenantId: string): Record<string, string> {
  // No gateway in this compose combo — the service is called directly, so the
  // "verified" trusted identity is supplied straight, exactly like the other
  // services' compose e2e specs (e.g. catalog-e2e, review-e2e).
  return { 'x-tenant-id': tenantId, 'x-user-id': 'analytics-e2e', 'x-roles': 'customer' };
}

async function getJson<T>(path: string, tenantId: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: tenantHeaders(tenantId) });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function pollUntil<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (predicate(value)) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the dashboard to reflect the produced events');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function fetchRevenue(tenantId: string, from: string, to: string): Promise<RevenuePoint[]> {
  return getJson<RevenuePoint[]>(`/analytics/revenue?from=${from}&to=${to}`, tenantId);
}

export function fetchTopRestaurants(
  tenantId: string,
  from: string,
  to: string,
  limit = 20,
): Promise<TopRestaurantEntry[]> {
  return getJson<TopRestaurantEntry[]>(
    `/analytics/top-restaurants?from=${from}&to=${to}&limit=${limit}`,
    tenantId,
  );
}

export function fetchSummary(tenantId: string, from: string, to: string): Promise<Summary> {
  return getJson<Summary>(`/analytics/summary?from=${from}&to=${to}`, tenantId);
}

/** Polls `/analytics/summary` until the predicate holds (the ingest consumer lags the produce call by a beat). */
export function pollSummaryUntil(
  tenantId: string,
  from: string,
  to: string,
  predicate: (summary: Summary) => boolean,
  timeoutMs?: number,
): Promise<Summary> {
  return pollUntil(() => fetchSummary(tenantId, from, to), predicate, timeoutMs);
}
