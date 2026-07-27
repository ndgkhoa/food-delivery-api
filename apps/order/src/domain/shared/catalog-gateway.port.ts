/** A menu item's price + availability as reported by the catalog, at the moment of validation. */
export interface MenuItemSnapshot {
  itemId: string;
  restaurantId: string;
  /** Integer cents — the authoritative price. The client-submitted price (if any) is never trusted. */
  priceCents: number;
  isAvailable: boolean;
}

/**
 * Outbound port to the catalog bounded context. Order never trusts a
 * client-submitted price; it always recomputes totals from what the catalog
 * reports for the tenant. Missing items (deleted, foreign-tenant, or unknown)
 * are simply absent from the returned list — the caller decides how to react.
 */
export interface CatalogGatewayPort {
  validateItems(tenantId: string, itemIds: string[]): Promise<MenuItemSnapshot[]>;
}

export const CATALOG_GATEWAY_PORT = Symbol('CatalogGatewayPort');
