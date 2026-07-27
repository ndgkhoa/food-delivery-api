import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class DeleteMenuItemHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly getMenuItem: GetMenuItemHandler,
  ) {}

  async execute(restaurantId: string, id: string): Promise<void> {
    const before = await this.getMenuItem.execute(restaurantId, id);

    // Write + audit share one commit boundary: if the audit insert fails, the soft-delete is rolled back.
    await this.transaction.runInTransaction(async () => {
      await this.menuItemRepository.softDelete(before.id, before.tenantId);

      await this.auditPort.record({
        action: AuditAction.DELETE,
        entity: 'menu_item',
        entityId: id,
        before: before.toSnapshot(),
      });
    });
  }
}
