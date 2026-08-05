import { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { ReadMenuItemRow } from '@catalog/domain/read-model/read-menu-item.repository';
import { ReadMenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/read-menu-item.orm-entity';

export class ReadMenuItemMapper {
  static toDomain(orm: ReadMenuItemOrmEntity): MenuItem {
    return MenuItem.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      restaurantId: orm.restaurantId,
      name: orm.name,
      description: orm.description,
      priceCents: orm.priceCents,
      isAvailable: orm.isAvailable,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
      deletedAt: null,
      version: orm.version,
    });
  }

  static toOrm(row: ReadMenuItemRow): ReadMenuItemOrmEntity {
    const orm = new ReadMenuItemOrmEntity();
    orm.id = row.id;
    orm.restaurantId = row.restaurantId;
    orm.tenantId = row.tenantId;
    orm.name = row.name;
    orm.description = row.description;
    orm.priceCents = row.priceCents;
    orm.isAvailable = row.isAvailable;
    orm.version = row.version;
    orm.createdAt = row.createdAt;
    orm.updatedAt = row.updatedAt;
    return orm;
  }
}
