import { randomUUID } from 'node:crypto';
import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import { MenuItem } from '@catalog/domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '@catalog/domain/shared/tenant-context.port';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

export interface CreateMenuItemCommand {
  name: string;
  description?: string;
  priceCents: number;
  isAvailable?: boolean;
}

@Injectable()
export class CreateMenuItemHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(restaurantId: string, command: CreateMenuItemCommand): Promise<MenuItem> {
    // Confirms the restaurant exists AND belongs to the caller's tenant before nesting a menu item under it.
    await this.getRestaurant.execute(restaurantId);
    const tenantId = this.tenantContext.getTenantIdOrThrow();

    const menuItem = MenuItem.create({ id: randomUUID(), tenantId, restaurantId, ...command });

    // Write + audit share one commit boundary: if the audit insert fails, the menu item is not persisted.
    return this.transaction.runInTransaction(async () => {
      const saved = await this.menuItemRepository.save(menuItem);

      await this.auditPort.record({
        action: AuditAction.CREATE,
        entity: 'menu_item',
        entityId: saved.id,
        after: saved.toSnapshot(),
      });

      return saved;
    });
  }
}
