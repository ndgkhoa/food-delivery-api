import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class DeleteRestaurantHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(id: string): Promise<void> {
    const before = await this.getRestaurant.execute(id);

    // Soft-deleting a restaurant cascades a soft-delete to its menu items so no
    // child rows are left dangling (live in the table yet unreachable via the
    // 404-ing parent). The single restaurant DELETE audit entry documents the
    // whole cascade. All three effects commit together or roll back together.
    await this.transaction.runInTransaction(async () => {
      await this.restaurantRepository.softDelete(before.id, before.tenantId);
      await this.menuItemRepository.softDeleteByRestaurant(before.id, before.tenantId);

      await this.auditPort.record({
        action: AuditAction.DELETE,
        entity: 'restaurant',
        entityId: id,
        before: before.toSnapshot(),
      });
    });
  }
}
