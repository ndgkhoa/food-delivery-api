import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { MenuItemResponse } from '@catalog/interface/http/dto/menu-item.response';

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
