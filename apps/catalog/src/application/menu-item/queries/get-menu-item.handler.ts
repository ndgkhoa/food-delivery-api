import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '@catalog/domain/shared/tenant-context.port';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class GetMenuItemHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(restaurantId: string, id: string): Promise<MenuItem> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const menuItem = await this.menuItemRepository.findById(id, restaurantId, tenantId);

    if (!menuItem) {
      throw new NotFoundException(`Menu item "${id}" not found on restaurant "${restaurantId}"`);
    }

    return menuItem;
  }
}
