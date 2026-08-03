/** WebSocket message names exchanged with driver + customer clients. */
export const WS_EVENTS = {
  /** Driver → server: `{ lat, lng }` position push. Server → room: `{ driverId, lat, lng }`. */
  LOCATION: 'location',
  /** Customer → server: `{ orderId }` request to watch an order's driver. */
  JOIN_ORDER: 'join-order',
  /** Server → customer: acknowledges a successful room join. */
  JOINED: 'joined',
  /** Server → room: `{ orderId, driverId }` when a driver is assigned. */
  ASSIGNED: 'assigned',
  /** Server → client: `{ message }` for a rejected/invalid action. */
  ERROR: 'error',
} as const;

/**
 * Tenant-prefixed Socket.IO room a driver's live position fans out to. Prefixing
 * with the tenant id guarantees a customer can never join (and a driver can never
 * broadcast into) another tenant's order room even if two tenants shared an id.
 */
export function orderRoom(tenantId: string, orderId: string): string {
  return `t:${tenantId}:order:${orderId}`;
}
