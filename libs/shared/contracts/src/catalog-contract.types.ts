import type { Observable } from 'rxjs';

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

export interface CatalogGrpcService {
  getMenuItems(
    request: GetMenuItemsRequest,
  ): Promise<MenuItemsResponse> | Observable<MenuItemsResponse> | MenuItemsResponse;
}

export interface CatalogGrpcClient {
  getMenuItems(request: GetMenuItemsRequest): Observable<MenuItemsResponse>;
}
