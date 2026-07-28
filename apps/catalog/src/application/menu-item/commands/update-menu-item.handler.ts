import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import type { MenuItem, UpdateMenuItemProps } from '@catalog/domain/menu-item/menu-item';
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

export type UpdateMenuItemCommand = UpdateMenuItemProps;

@Injectable()
export class UpdateMenuItemHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(OUTBOX_PORT) private readonly outboxWriter: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly getMenuItem: GetMenuItemHandler,
  ) {}

  async execute(
    restaurantId: string,
    id: string,
    command: UpdateMenuItemCommand,
  ): Promise<MenuItem> {
    const before = await this.getMenuItem.execute(restaurantId, id);
    const updated = before.update(command);

    // Write + audit + outbox share one commit boundary: the update and its
    // emitted event commit or roll back together.
    return this.transaction.runInTransaction(async () => {
      const saved = await this.menuItemRepository.save(updated);

      await this.auditPort.record({
        action: AuditAction.UPDATE,
        entity: 'menu_item',
        entityId: id,
        before: before.toSnapshot(),
        after: saved.toSnapshot(),
      });
      await this.outboxWriter.write(CatalogEventFactory.menuItemUpdated(saved));

      return saved;
    });
  }
}
