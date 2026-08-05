import type { MenuItemFixture } from './demo-data-fixtures';
import type { GatewayClient } from './gateway-api-client';
import type { SeedState } from './seed-state-store';

interface RestaurantResponse {
  id: string;
}
interface MenuItemResponse {
  id: string;
  priceCents: number;
}

export interface CreatedRestaurant {
  id: string;
  menuItems: { id: string; priceCents: number }[];
}

export async function createRestaurant(
  ownerGateway: GatewayClient,
  tenantId: string,
  state: SeedState,
  name: string,
  description: string,
  items: MenuItemFixture[],
): Promise<CreatedRestaurant> {
  const restaurant = await ownerGateway.request<RestaurantResponse>(
    `create restaurant "${name}"`,
    'POST',
    '/catalog/restaurants',
    { name, description },
  );
  const menuItems: { id: string; priceCents: number }[] = [];
  for (const itemFixture of items) {
    const item = await ownerGateway.request<MenuItemResponse>(
      `create menu item "${itemFixture.name}" for "${name}"`,
      'POST',
      `/catalog/restaurants/${restaurant.id}/menu-items`,
      {
        name: itemFixture.name,
        description: itemFixture.description,
        priceCents: itemFixture.priceCents,
      },
    );
    menuItems.push({ id: item.id, priceCents: item.priceCents });
    state.stock.push({ tenantId, itemId: item.id });
  }
  state.restaurants.push({
    id: restaurant.id,
    tenantId,
    name,
    menuItems: menuItems.map((item, index) => ({ id: item.id, name: items[index].name })),
  });
  return { id: restaurant.id, menuItems };
}
