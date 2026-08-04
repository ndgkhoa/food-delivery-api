export interface MenuItemSnapshot {
  itemId: string;
  restaurantId: string;
  priceCents: number;
  isAvailable: boolean;
}

export interface CatalogGatewayPort {
  validateItems(tenantId: string, itemIds: string[]): Promise<MenuItemSnapshot[]>;
}

export const CATALOG_GATEWAY_PORT = Symbol('CatalogGatewayPort');
