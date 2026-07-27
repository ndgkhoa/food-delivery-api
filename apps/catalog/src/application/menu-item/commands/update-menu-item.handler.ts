import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import type { MenuItem, UpdateMenuItemProps } from '@catalog/domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { Inject, Injectable } from '@nestjs/common';

export type UpdateMenuItemCommand = UpdateMenuItemProps;

@Injectable()
export class UpdateMenuItemHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    private readonly getMenuItem: GetMenuItemHandler,
  ) {}

  async execute(
    restaurantId: string,
    id: string,
    command: UpdateMenuItemCommand,
  ): Promise<MenuItem> {
    const before = await this.getMenuItem.execute(restaurantId, id);
    const updated = before.update(command);
    const saved = await this.menuItemRepository.save(updated);

    await this.auditPort.record({
      action: AuditAction.UPDATE,
      entity: 'menu_item',
      entityId: id,
      before: before.toSnapshot(),
      after: saved.toSnapshot(),
    });

    return saved;
  }
}
