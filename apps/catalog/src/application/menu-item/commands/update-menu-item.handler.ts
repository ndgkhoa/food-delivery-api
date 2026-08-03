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

/**
 * `expectedVersion` is the client's optional `If-Match` value (the version it
 * last read) — distinct from the domain's own `update()` field changes, so
 * it's layered on here rather than polluting `UpdateMenuItemProps`.
 */
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

    // Client sent a stale `If-Match`: fail fast before touching the DB. If
    // absent, only the save-time version guard below protects against a
    // concurrent in-flight write.
    if (expectedVersion !== undefined && expectedVersion !== before.version) {
      throw new ConcurrencyConflictError('MenuItem', id);
    }

    const updated = before.update(changes);

    // Write + audit + outbox share one commit boundary: the update and its
    // emitted event commit or roll back together. A version conflict thrown
    // by `updateVersioned` aborts before the audit/outbox writes, so a
    // rejected write never leaves a stray audit row.
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
