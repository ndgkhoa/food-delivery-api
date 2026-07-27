import { Inject, Injectable } from '@nestjs/common';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '../../../domain/menu-item/menu-item.repository';
import { AUDIT_PORT, type AuditPort } from '../../../domain/shared/audit.port';
import { AuditAction } from '../../../domain/shared/audit-action';
import { GetMenuItemHandler } from '../queries/get-menu-item.handler';

@Injectable()
export class DeleteMenuItemHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    private readonly getMenuItem: GetMenuItemHandler,
  ) {}

  async execute(restaurantId: string, id: string): Promise<void> {
    const before = await this.getMenuItem.execute(restaurantId, id);
    await this.menuItemRepository.softDelete(before.id, before.tenantId);

    await this.auditPort.record({
      action: AuditAction.DELETE,
      entity: 'menu_item',
      entityId: id,
      before: before.toSnapshot(),
    });
  }
}
