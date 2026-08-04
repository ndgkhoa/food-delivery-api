import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { MenuItemMessage } from '@food-delivery-api/shared-contracts';

export class MenuItemGrpcMapper {
  static toMessage(item: MenuItem): MenuItemMessage {
    return {
      id: item.id,
      tenantId: item.tenantId,
      restaurantId: item.restaurantId,
      name: item.name,
      description: item.description ?? '',
      priceCents: item.priceCents,
      isAvailable: item.isAvailable,
    };
  }
}
