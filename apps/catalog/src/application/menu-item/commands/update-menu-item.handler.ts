import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import type { MenuItem, UpdateMenuItemProps } from '@catalog/domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { CatalogEventFactory } from '@catalog/domain/shared/catalog-event.factory';
import { ConcurrencyConflictError } from '@catalog/domain/shared/errors';
import { OUTBOX_PORT, type OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

export type UpdateMenuItemCommand = UpdateMenuItemProps & { expectedVersion?: number };

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
    const { expectedVersion, ...changes } = command;
    const before = await this.getMenuItem.execute(restaurantId, id);

    if (expectedVersion !== undefined && expectedVersion !== before.version) {
      throw new ConcurrencyConflictError('MenuItem', id);
    }

    const updated = before.update(changes);

    return this.transaction.runInTransaction(async () => {
      const saved = await this.menuItemRepository.updateVersioned(updated);

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
