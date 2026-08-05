import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { MenuItemRepository } from '@catalog/domain/menu-item/menu-item.repository';
import { EntityNotFoundError } from '@catalog/domain/shared/errors';
import type { PageResult } from '@catalog/domain/shared/pagination';
import type { TenantContextPort } from '@food-delivery-api/shared-tenancy';

const tenantId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';

class FakeMenuItemRepository implements MenuItemRepository {
  private readonly rows = new Map<string, MenuItem>();

  seed(menuItem: MenuItem): void {
    this.rows.set(menuItem.id, menuItem);
  }

  async save(menuItem: MenuItem): Promise<MenuItem> {
    this.rows.set(menuItem.id, menuItem);
    return menuItem;
  }

  async updateVersioned(menuItem: MenuItem): Promise<MenuItem> {
    return menuItem;
  }

  async findById(
    id: string,
    itemRestaurantId: string,
    itemTenantId: string,
  ): Promise<MenuItem | null> {
    const row = this.rows.get(id);
    return row && row.restaurantId === itemRestaurantId && row.tenantId === itemTenantId
      ? row
      : null;
  }

  async findManyByIds(): Promise<MenuItem[]> {
    return [];
  }

  async findAndCountByRestaurant(): Promise<PageResult<MenuItem>> {
    return { data: [], total: 0 };
  }

  async findAllByRestaurant(): Promise<MenuItem[]> {
    return [];
  }

  async softDelete(): Promise<void> {}
  async softDeleteByRestaurant(): Promise<void> {}
}

function buildTenantContext(id: string): TenantContextPort {
  return {
    getTenantIdOrThrow: () => id,
  } as unknown as TenantContextPort;
}

function buildMenuItem(): MenuItem {
  return MenuItem.create({
    id: 'item-1',
    tenantId,
    restaurantId,
    name: 'Pho Bo',
    priceCents: 8500,
  });
}

describe('GetMenuItemHandler', () => {
  it('returns the menu item scoped to the restaurant and current tenant', async () => {
    const repository = new FakeMenuItemRepository();
    const menuItem = buildMenuItem();
    repository.seed(menuItem);
    const handler = new GetMenuItemHandler(repository, buildTenantContext(tenantId));

    const found = await handler.execute(restaurantId, menuItem.id);

    expect(found).toBe(menuItem);
  });

  it('throws EntityNotFoundError when no menu item matches the id', async () => {
    const repository = new FakeMenuItemRepository();
    const handler = new GetMenuItemHandler(repository, buildTenantContext(tenantId));

    await expect(handler.execute(restaurantId, 'missing-id')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    );
  });

  it('throws EntityNotFoundError when the menu item belongs to another tenant', async () => {
    const repository = new FakeMenuItemRepository();
    const menuItem = buildMenuItem();
    repository.seed(menuItem);
    const handler = new GetMenuItemHandler(
      repository,
      buildTenantContext('99999999-9999-4999-8999-999999999999'),
    );

    await expect(handler.execute(restaurantId, menuItem.id)).rejects.toThrow(
      `Menu item "${menuItem.id}" not found on restaurant "${restaurantId}"`,
    );
  });
});
