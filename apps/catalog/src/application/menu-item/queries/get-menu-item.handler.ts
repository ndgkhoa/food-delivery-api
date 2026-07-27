import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MenuItem } from '../../../domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '../../../domain/menu-item/menu-item.repository';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '../../../domain/shared/tenant-context.port';

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
