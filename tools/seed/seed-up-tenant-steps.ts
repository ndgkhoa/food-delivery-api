import { randomUUID } from 'node:crypto';
import { CONFIG_VALUES, type TenantFixture } from './demo-data-fixtures';
import { GatewayClient } from './gateway-api-client';
import { upsertStock, withInventoryDb } from './inventory-stock-db';
import { loginPassword } from './keycloak-admin-client';
import type { SeedConfig } from './seed-config';
import type { SeedState } from './seed-state-store';
import type { CreatedRestaurant } from './seed-up-catalog';
import type { ProvisionedUser } from './seed-up-provisioning';

interface OrderResponse {
  id: string;
}

/** PUTs the tenant's config overrides as its own `admin` user (own-tenant writes never need `platform-admin`). */
export async function seedTenantConfig(
  config: SeedConfig,
  admin: ProvisionedUser,
  tenantId: string,
  state: SeedState,
): Promise<void> {
  console.log(`  setting ${CONFIG_VALUES.length} config values as tenant admin...`);
  const adminToken = await loginPassword(config, admin.username, admin.password);
  const adminGateway = new GatewayClient(config.gatewayUrl, adminToken);
  for (const configValue of CONFIG_VALUES) {
    await adminGateway.request(
      `set config "${configValue.key}"`,
      'PUT',
      `/config/${configValue.key}`,
      { value: configValue.value },
    );
    state.configValues.push({ key: configValue.key, tenantId });
  }
}

export async function seedTenantStock(
  config: SeedConfig,
  tenantId: string,
  fixture: TenantFixture,
  createdRestaurants: CreatedRestaurant[],
): Promise<void> {
  console.log('  inserting inventory stock rows...');
  await withInventoryDb(config, async (client) => {
    for (const [restaurantIndex, restaurantFixture] of fixture.restaurants.entries()) {
      const created = createdRestaurants[restaurantIndex];
      for (const [itemIndex, itemFixture] of restaurantFixture.menuItems.entries()) {
        await upsertStock(client, tenantId, created.menuItems[itemIndex].id, itemFixture.stockQty);
      }
    }
  });
}

/** Places the demo orders as the tenant's customer, returning both the created ids and the authenticated gateway client (reused to poll status + submit reviews for those SAME orders). */
export async function placeDemoOrders(
  config: SeedConfig,
  customer: ProvisionedUser,
  tenantId: string,
  targetRestaurant: CreatedRestaurant,
  state: SeedState,
): Promise<{ orderIds: string[]; customerGateway: GatewayClient }> {
  console.log(`  placing 2 demo orders as "${customer.username}"...`);
  const customerToken = await loginPassword(config, customer.username, customer.password);
  const customerGateway = new GatewayClient(config.gatewayUrl, customerToken);
  const orderIds: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const order = await customerGateway.request<OrderResponse>(
      `place demo order #${i + 1}`,
      'POST',
      '/orders',
      {
        items: targetRestaurant.menuItems
          .slice(0, 2)
          .map((item) => ({ itemId: item.id, qty: i + 1 })),
      },
      { 'idempotency-key': randomUUID() },
    );
    state.orders.push({ id: order.id, tenantId });
    orderIds.push(order.id);
  }
  return { orderIds, customerGateway };
}
