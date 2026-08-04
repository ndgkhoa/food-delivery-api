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

export interface InventoryGatewayPort {
  reserve(tenantId: string, orderId: string, items: ReserveItemCommand[]): Promise<ReserveOutcome>;
  release(tenantId: string, orderId: string): Promise<ReleaseOutcome>;
}

export const INVENTORY_GATEWAY_PORT = Symbol('InventoryGatewayPort');
