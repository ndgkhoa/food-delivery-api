import type { MenuItem } from '../../../domain/menu-item/menu-item';
import type { MenuItemResponse } from '../dto/menu-item.response';

export class MenuItemResponseMapper {
  static toResponse(menuItem: MenuItem): MenuItemResponse {
    return {
      id: menuItem.id,
      tenantId: menuItem.tenantId,
      restaurantId: menuItem.restaurantId,
      name: menuItem.name,
      description: menuItem.description,
      priceCents: menuItem.priceCents,
      isAvailable: menuItem.isAvailable,
      createdAt: menuItem.createdAt,
      updatedAt: menuItem.updatedAt,
    };
  }
}
