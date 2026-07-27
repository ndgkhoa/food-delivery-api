export interface ReserveItemCommand {
  itemId: string;
  qty: number;
}

export interface ReserveOutcome {
  ok: boolean;
  reservationIds: string[];
}

export interface ReleaseOutcome {
  ok: boolean;
}

/**
 * Outbound port to the inventory bounded context. Order does NOT own stock —
 * it delegates reserve/release to inventory over gRPC and reacts to the
 * outcome. Reserve is idempotent by `orderId`: replaying the same order with
 * the same items is expected to return the same reservation ids rather than
 * double-decrementing.
 */
export interface InventoryGatewayPort {
  reserve(tenantId: string, orderId: string, items: ReserveItemCommand[]): Promise<ReserveOutcome>;
  release(tenantId: string, orderId: string): Promise<ReleaseOutcome>;
}

export const INVENTORY_GATEWAY_PORT = Symbol('InventoryGatewayPort');
