import type { ReadRestaurantRow } from '@catalog/domain/read-model/read-restaurant.repository';
import { ReadRestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/read-restaurant.orm-entity';
import { ReadRestaurantMapper } from '@catalog/infrastructure/persistence/mappers/read-restaurant.mapper';

const tenantId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-07-28T00:00:00.000Z');

function ormRow(version: number): ReadRestaurantOrmEntity {
  const orm = new ReadRestaurantOrmEntity();
  orm.id = restaurantId;
  orm.tenantId = tenantId;
  orm.name = 'Pho House';
  orm.description = null;
  orm.isActive = true;
  orm.rating = 4.5;
  orm.reviewCount = 10;
  orm.version = version;
  orm.createdAt = now;
  orm.updatedAt = now;
  return orm;
}

describe('ReadRestaurantMapper', () => {
  it('maps the projected version onto the domain aggregate — not the `?? 1` default', () => {
    const restaurant = ReadRestaurantMapper.toDomain(ormRow(7));

    expect(restaurant.version).toBe(7);
  });

  it('round-trips a row through toOrm without dropping the version', () => {
    const row: ReadRestaurantRow = {
      id: restaurantId,
      tenantId,
      name: 'Pho House',
      description: null,
      isActive: true,
      version: 9,
      createdAt: now,
      updatedAt: now,
    };

    const orm = ReadRestaurantMapper.toOrm(row);

    expect(orm.version).toBe(9);
  });
});
