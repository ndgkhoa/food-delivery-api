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
import { CatalogEventFactory } from '@catalog/domain/shared/catalog-event.factory';
import { OUTBOX_PORT, type OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class DeleteRestaurantHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(OUTBOX_PORT) private readonly outboxWriter: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(id: string): Promise<void> {
    const before = await this.getRestaurant.execute(id);

    // Soft-deleting a restaurant cascades a soft-delete to its menu items so no
    // child rows are left dangling (live in the table yet unreachable via the
    // 404-ing parent). We emit RestaurantDeleted AND a MenuItemDeleted per item:
    // restaurant and item are separate aggregates on separate Kafka partitions,
    // so a bulk "remove all items of this restaurant" on the restaurant event
    // can't be ordered against an in-flight item update on the item's partition
    // — that update would re-insert an orphan read row. Keying a delete event to
    // each item id puts its terminal event on the item's own partition, after
    // any earlier update, so the read model converges with no orphans. All
    // effects commit or roll back together.
    await this.transaction.runInTransaction(async () => {
      const items = await this.menuItemRepository.findAllByRestaurant(before.id, before.tenantId);

      await this.restaurantRepository.softDelete(before.id, before.tenantId);
      await this.menuItemRepository.softDeleteByRestaurant(before.id, before.tenantId);

      await this.auditPort.record({
        action: AuditAction.DELETE,
        entity: 'restaurant',
        entityId: id,
        before: before.toSnapshot(),
      });
      await this.outboxWriter.write(CatalogEventFactory.restaurantDeleted(before));
      for (const item of items) {
        await this.outboxWriter.write(CatalogEventFactory.menuItemDeleted(item));
      }
    });
  }
}
