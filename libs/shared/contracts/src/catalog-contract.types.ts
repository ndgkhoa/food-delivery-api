import type { Observable } from 'rxjs';

/**
 * Hand-written TypeScript shapes for the `catalog.proto` messages. Field names
 * are camelCase to match `@grpc/proto-loader` with `keepCase: false` (the
 * option the servers/clients pass), so the wire's snake_case maps cleanly onto
 * idiomatic TS.
 */
export interface GetMenuItemsRequest {
  tenantId: string;
  ids: string[];
}

export interface MenuItemMessage {
  id: string;
  tenantId: string;
  restaurantId: string;
  name: string;
  description: string;
  priceCents: number;
  isAvailable: boolean;
}

export interface MenuItemsResponse {
  items: MenuItemMessage[];
}

/**
 * Server-side contract a NestJS gRPC controller implements. Handlers may return
 * a value, a Promise, or an Observable — the transport unwraps all three.
 */
export interface CatalogGrpcService {
  getMenuItems(
    request: GetMenuItemsRequest,
  ): Promise<MenuItemsResponse> | Observable<MenuItemsResponse> | MenuItemsResponse;
}
