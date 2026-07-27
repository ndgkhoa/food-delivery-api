import { MenuItem } from '@catalog/domain/menu-item/menu-item';
import { MenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/menu-item.orm-entity';

export class MenuItemMapper {
  static toDomain(orm: MenuItemOrmEntity): MenuItem {
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
      deletedAt: orm.deletedAt,
    });
  }

  static toOrm(domain: MenuItem): MenuItemOrmEntity {
    const orm = new MenuItemOrmEntity();
    orm.id = domain.id;
    orm.tenantId = domain.tenantId;
    orm.restaurantId = domain.restaurantId;
    orm.name = domain.name;
    orm.description = domain.description;
    orm.priceCents = domain.priceCents;
    orm.isAvailable = domain.isAvailable;
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.updatedAt;
    orm.deletedAt = domain.deletedAt;
    return orm;
  }
}
