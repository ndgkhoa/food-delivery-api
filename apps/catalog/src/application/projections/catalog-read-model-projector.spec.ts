import { applyCatalogEvent } from '@catalog/application/projections/catalog-read-model-projector';
import type {
  ReadMenuItemRepository,
  ReadMenuItemRow,
} from '@catalog/domain/read-model/read-menu-item.repository';
import type {
  ReadRestaurantRepository,
  ReadRestaurantRow,
} from '@catalog/domain/read-model/read-restaurant.repository';
import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';

class FakeReadRestaurantRepository implements ReadRestaurantRepository {
  readonly upserted: ReadRestaurantRow[] = [];
  readonly removed: Array<{ id: string; tenantId: string }> = [];
  async findById() {
    return null;
  }
  async findAndCount() {
    return { data: [], total: 0 };
  }
  async upsert(row: ReadRestaurantRow) {
    this.upserted.push(row);
  }
  async remove(id: string, tenantId: string) {
    this.removed.push({ id, tenantId });
  }
  async updateRating() {}
}

class FakeReadMenuItemRepository implements ReadMenuItemRepository {
  readonly upserted: ReadMenuItemRow[] = [];
  readonly removed: Array<{ id: string; tenantId: string }> = [];
  readonly removedByRestaurant: Array<{ restaurantId: string; tenantId: string }> = [];
  async findAndCountByRestaurant() {
    return { data: [], total: 0 };
  }
  async upsert(row: ReadMenuItemRow) {
    this.upserted.push(row);
  }
  async remove(id: string, tenantId: string) {
    this.removed.push({ id, tenantId });
  }
  async removeByRestaurant(restaurantId: string, tenantId: string) {
    this.removedByRestaurant.push({ restaurantId, tenantId });
  }
}

const tenantId = '11111111-1111-4111-8111-111111111111';
const aggregateId = '22222222-2222-4222-8222-222222222222';

function envelope(eventType: string): EventEnvelopeHeaders {
  return {
    eventId: '33333333-3333-4333-8333-333333333333',
    eventType,
    aggregateId,
    tenantId,
    correlationId: '44444444-4444-4444-8444-444444444444',
    occurredAt: new Date().toISOString(),
  };
}

describe('applyCatalogEvent', () => {
  let restaurants: FakeReadRestaurantRepository;
  let menuItems: FakeReadMenuItemRepository;

  beforeEach(() => {
    restaurants = new FakeReadRestaurantRepository();
    menuItems = new FakeReadMenuItemRepository();
  });

  const repos = () => ({ restaurants, menuItems });

  it('upserts a restaurant read row from RestaurantCreated using envelope identity', async () => {
    await applyCatalogEvent(
      envelope('RestaurantCreated'),
      {
        name: 'Pho House',
        description: null,
        isActive: true,
        version: 1,
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
      repos(),
    );

    expect(restaurants.upserted).toHaveLength(1);
    expect(restaurants.upserted[0]).toMatchObject({ id: aggregateId, tenantId, name: 'Pho House' });
    expect(restaurants.upserted[0].createdAt).toBeInstanceOf(Date);
  });

  it('projects the write aggregate version into the restaurant read row, not a constant', async () => {
    await applyCatalogEvent(
      envelope('RestaurantUpdated'),
      {
        name: 'Pho House',
        description: null,
        isActive: true,
        version: 4,
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
      repos(),
    );

    expect(restaurants.upserted[0]).toMatchObject({ version: 4 });
  });

  it('removes the restaurant read row and cascades to its menu items on RestaurantDeleted', async () => {
    await applyCatalogEvent(envelope('RestaurantDeleted'), {}, repos());

    expect(restaurants.removed).toEqual([{ id: aggregateId, tenantId }]);
    expect(menuItems.removedByRestaurant).toEqual([{ restaurantId: aggregateId, tenantId }]);
  });

  it('upserts a menu-item read row from MenuItemUpdated', async () => {
    await applyCatalogEvent(
      envelope('MenuItemUpdated'),
      {
        restaurantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Pho Bo',
        description: null,
        priceCents: 9000,
        isAvailable: true,
        version: 3,
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
      repos(),
    );

    expect(menuItems.upserted).toHaveLength(1);
    expect(menuItems.upserted[0]).toMatchObject({ id: aggregateId, priceCents: 9000, version: 3 });
  });

  it('removes only the single menu-item read row on MenuItemDeleted', async () => {
    await applyCatalogEvent(envelope('MenuItemDeleted'), {}, repos());

    expect(menuItems.removed).toEqual([{ id: aggregateId, tenantId }]);
    expect(restaurants.removed).toHaveLength(0);
  });

  it('ignores an unknown event type without touching either read model', async () => {
    await applyCatalogEvent(envelope('SomethingElse'), {}, repos());

    expect(restaurants.upserted).toHaveLength(0);
    expect(menuItems.upserted).toHaveLength(0);
  });
});
