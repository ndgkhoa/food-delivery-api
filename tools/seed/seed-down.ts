import { CONFIG_DEFAULTS } from './demo-data-fixtures';
import { describeError, GatewayClient } from './gateway-api-client';
import { deleteStock, withInventoryDb } from './inventory-stock-db';
import { deleteKeycloakUser, getKeycloakAdminToken, loginPassword } from './keycloak-admin-client';
import { deleteMediaRow, withMediaDb } from './media-db';
import { createMinioClient, removeMediaObject } from './minio-media-store';
import { removeDriverLocation, withRedis } from './redis-driver-geo';
import type { SeedConfig } from './seed-config';
import {
  deletePartitionDemoOrders,
  dropPartitionsCreated,
} from './seed-down-scenario-partitioning';
import { resolveFixtureUser } from './seed-fixture-user-lookup';
import { loadState, removeState, type SeedState } from './seed-state-store';

async function cancelOrders(config: SeedConfig, state: SeedState): Promise<void> {
  console.log(`\n[1/9] Cancelling ${state.orders.length} order(s)...`);
  for (const order of state.orders) {
    const creds = resolveFixtureUser(state, order.tenantId, 'admin');
    if (!creds) {
      console.warn(`  ! cannot resolve tenant admin for order ${order.id} — skipping cancel`);
      continue;
    }
    try {
      const token = await loginPassword(config, creds.username, creds.password);
      const gateway = new GatewayClient(config.gatewayUrl, token);
      await gateway.request(`cancel order ${order.id}`, 'POST', `/orders/${order.id}/cancel`);
      console.log(`  cancelled ${order.id}`);
    } catch (error) {
      console.warn(`  ! could not cancel order ${order.id}: ${describeError(error)}`);
    }
  }
}

async function deleteCatalogEntries(config: SeedConfig, state: SeedState): Promise<void> {
  console.log(
    `\n[2/9] Deleting menu items + restaurants for ${state.restaurants.length} restaurant(s)...`,
  );
  for (const restaurant of state.restaurants) {
    const creds = resolveFixtureUser(state, restaurant.tenantId, 'restaurant-owner');
    if (!creds) {
      console.warn(`  ! cannot resolve tenant owner for restaurant ${restaurant.id} — skipping`);
      continue;
    }
    const token = await loginPassword(config, creds.username, creds.password);
    const gateway = new GatewayClient(config.gatewayUrl, token);
    for (const item of restaurant.menuItems) {
      try {
        await gateway.request(
          `delete menu item "${item.name}"`,
          'DELETE',
          `/catalog/restaurants/${restaurant.id}/menu-items/${item.id}`,
        );
      } catch (error) {
        console.warn(`  ! could not delete menu item "${item.name}": ${describeError(error)}`);
      }
    }
    try {
      await gateway.request(
        `delete restaurant "${restaurant.name}"`,
        'DELETE',
        `/catalog/restaurants/${restaurant.id}`,
      );
      console.log(`  deleted restaurant "${restaurant.name}"`);
    } catch (error) {
      console.warn(`  ! could not delete restaurant "${restaurant.name}": ${describeError(error)}`);
    }
  }
}

async function resetConfigValues(config: SeedConfig, state: SeedState): Promise<void> {
  console.log(
    `\n[3/9] Resetting ${state.configValues.length} config value(s) to service defaults...`,
  );
  for (const configValue of state.configValues) {
    const creds = resolveFixtureUser(state, configValue.tenantId, 'admin');
    if (!creds) {
      console.warn(`  ! cannot resolve tenant admin for config "${configValue.key}" — skipping`);
      continue;
    }
    try {
      const token = await loginPassword(config, creds.username, creds.password);
      const gateway = new GatewayClient(config.gatewayUrl, token);
      const defaultValue = CONFIG_DEFAULTS[configValue.key] ?? 0;
      await gateway.request(
        `reset config "${configValue.key}"`,
        'PUT',
        `/config/${configValue.key}`,
        {
          value: defaultValue,
        },
      );
      console.log(`  reset ${configValue.key} -> ${defaultValue}`);
    } catch (error) {
      console.warn(`  ! could not reset config "${configValue.key}": ${describeError(error)}`);
    }
  }
}

async function deleteStockRows(config: SeedConfig, state: SeedState): Promise<void> {
  console.log(`\n[4/9] Deleting ${state.stock.length} inventory stock row(s)...`);
  await withInventoryDb(config, async (client) => {
    for (const stock of state.stock) {
      await deleteStock(client, stock.tenantId, stock.itemId);
    }
  });
}

async function removeDriverLocations(config: SeedConfig, state: SeedState): Promise<void> {
  console.log(`\n[5/9] Removing ${state.driverLocations.length} driver GEO location(s)...`);
  await withRedis(config, async (redis) => {
    for (const location of state.driverLocations) {
      try {
        await removeDriverLocation(redis, location.tenantId, location.driverId);
      } catch (error) {
        console.warn(
          `  ! could not remove driver GEO location for driver ${location.driverId}: ${describeError(error)}`,
        );
      }
    }
  });
}

async function deleteMediaObjects(config: SeedConfig, state: SeedState): Promise<void> {
  console.log(`\n[6/9] Deleting ${state.media.length} media object(s) (MinIO + DB row)...`);
  const minio = createMinioClient(config);
  await withMediaDb(config, async (db) => {
    for (const media of state.media) {
      try {
        await removeMediaObject(minio, config.mediaBucket, media.objectKey);
        await deleteMediaRow(db, media.id);
        console.log(`  removed object + row ${media.objectKey}`);
      } catch (error) {
        console.warn(
          `  ! could not fully remove media ${media.objectKey}: ${describeError(error)}`,
        );
      }
    }
  });
}

async function deleteKeycloakUsers(config: SeedConfig, state: SeedState): Promise<void> {
  console.log(`\n[7/9] Deleting ${state.users.length} Keycloak user(s)...`);
  const adminToken = await getKeycloakAdminToken(config);
  for (const user of state.users) {
    try {
      await deleteKeycloakUser(config, adminToken, user.keycloakUserId);
      console.log(`  deleted ${user.username}`);
    } catch (error) {
      console.warn(`  ! could not delete user "${user.username}": ${describeError(error)}`);
    }
  }
}

export async function seedDown(config: SeedConfig): Promise<void> {
  const state = await loadState();
  if (!state) {
    console.log('No tools/seed/.seed-state.json found — nothing to tear down.');
    return;
  }

  console.log('== Demo data seeder: down ==');
  await cancelOrders(config, state);
  await deleteCatalogEntries(config, state);
  await resetConfigValues(config, state);
  await deleteStockRows(config, state);
  await removeDriverLocations(config, state);
  await deleteMediaObjects(config, state);
  await deleteKeycloakUsers(config, state);
  await deletePartitionDemoOrders(config, state);
  await dropPartitionsCreated(config, state);

  await removeState();
  console.log('\n== Teardown complete ==');
  console.log(
    'Tenants themselves were left in place — no DELETE /tenants endpoint exists on the auth API.',
  );
  if (state.reviews.length > 0) {
    console.log(
      `${state.reviews.length} review(s) were left in place — no DELETE /reviews endpoint exists on the review API.`,
    );
  }
}
