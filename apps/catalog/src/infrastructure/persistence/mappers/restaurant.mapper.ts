import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';

export class RestaurantMapper {
  static toDomain(orm: RestaurantOrmEntity): Restaurant {
    return Restaurant.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      name: orm.name,
      description: orm.description,
      isActive: orm.isActive,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
      deletedAt: orm.deletedAt,
    });
  }

  static toOrm(domain: Restaurant): RestaurantOrmEntity {
    const orm = new RestaurantOrmEntity();
    orm.id = domain.id;
    orm.tenantId = domain.tenantId;
    orm.name = domain.name;
    orm.description = domain.description;
    orm.isActive = domain.isActive;
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.updatedAt;
    orm.deletedAt = domain.deletedAt;
    return orm;
  }
}
