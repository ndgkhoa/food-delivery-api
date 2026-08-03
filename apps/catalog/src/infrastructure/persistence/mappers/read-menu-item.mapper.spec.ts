import type { ReadMenuItemRow } from '@catalog/domain/read-model/read-menu-item.repository';
import { ReadMenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/read-menu-item.orm-entity';
import { ReadMenuItemMapper } from '@catalog/infrastructure/persistence/mappers/read-menu-item.mapper';

const tenantId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const menuItemId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-07-28T00:00:00.000Z');

function ormRow(version: number): ReadMenuItemOrmEntity {
  const orm = new ReadMenuItemOrmEntity();
  orm.id = menuItemId;
  orm.restaurantId = restaurantId;
  orm.tenantId = tenantId;
  orm.name = 'Pho Bo';
  orm.description = null;
  orm.priceCents = 8500;
  orm.isAvailable = true;
  orm.version = version;
  orm.createdAt = now;
  orm.updatedAt = now;
  return orm;
}

describe('ReadMenuItemMapper', () => {
  it('maps the projected version onto the domain aggregate — not the `?? 1` default', () => {
    const menuItem = ReadMenuItemMapper.toDomain(ormRow(6));

    expect(menuItem.version).toBe(6);
  });

  it('round-trips a row through toOrm without dropping the version', () => {
    const row: ReadMenuItemRow = {
      id: menuItemId,
      restaurantId,
      tenantId,
      name: 'Pho Bo',
      description: null,
      priceCents: 8500,
      isAvailable: true,
      version: 2,
      createdAt: now,
      updatedAt: now,
    };

    const orm = ReadMenuItemMapper.toOrm(row);

    expect(orm.version).toBe(2);
  });
});
