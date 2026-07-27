import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Bulk menu-item lookup for east-west callers (order/inventory over gRPC).
 * Tenant scope comes from the request context — established from gRPC metadata
 * by the gRPC tenant interceptor, exactly as HTTP reads use it — so a caller
 * can only ever resolve items within its own tenant.
 */
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
