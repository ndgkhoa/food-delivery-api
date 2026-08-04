import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetMenuItemsByIdsHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(ids: string[]): Promise<MenuItem[]> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.menuItemRepository.findManyByIds(ids, tenantId);
  }
}
