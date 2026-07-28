import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { CatalogEventFactory } from '@catalog/domain/shared/catalog-event.factory';
import { OUTBOX_PORT, type OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class DeleteMenuItemHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(OUTBOX_PORT) private readonly outboxWriter: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly getMenuItem: GetMenuItemHandler,
  ) {}

  async execute(restaurantId: string, id: string): Promise<void> {
    const before = await this.getMenuItem.execute(restaurantId, id);

    // Write + audit + outbox share one commit boundary: the soft-delete and its
    // emitted event commit or roll back together.
    await this.transaction.runInTransaction(async () => {
      await this.menuItemRepository.softDelete(before.id, before.tenantId);

      await this.auditPort.record({
        action: AuditAction.DELETE,
        entity: 'menu_item',
        entityId: id,
        before: before.toSnapshot(),
      });
      await this.outboxWriter.write(CatalogEventFactory.menuItemDeleted(before));
    });
  }
}
