import type { ReadRestaurantRow } from '@catalog/domain/read-model/read-restaurant.repository';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { ReadRestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/read-restaurant.orm-entity';

export class ReadRestaurantMapper {
  /** Read rows only ever hold live restaurants, so `deletedAt` is always null. */
  static toDomain(orm: ReadRestaurantOrmEntity): Restaurant {
    return Restaurant.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      name: orm.name,
      description: orm.description,
      isActive: orm.isActive,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
      deletedAt: null,
    });
  }

  static toOrm(row: ReadRestaurantRow): ReadRestaurantOrmEntity {
    const orm = new ReadRestaurantOrmEntity();
    orm.id = row.id;
    orm.tenantId = row.tenantId;
    orm.name = row.name;
    orm.description = row.description;
    orm.isActive = row.isActive;
    orm.createdAt = row.createdAt;
    orm.updatedAt = row.updatedAt;
    return orm;
  }
}
