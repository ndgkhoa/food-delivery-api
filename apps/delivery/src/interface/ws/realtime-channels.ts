export const WS_EVENTS = {
  LOCATION: 'location',
  JOIN_ORDER: 'join-order',
  JOINED: 'joined',
  ASSIGNED: 'assigned',
  ERROR: 'error',
} as const;

export function orderRoom(tenantId: string, orderId: string): string {
  return `t:${tenantId}:order:${orderId}`;
}
