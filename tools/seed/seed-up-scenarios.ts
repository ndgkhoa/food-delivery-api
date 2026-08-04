import { describeError, GatewayClient } from './gateway-api-client';
import { upsertStock, withInventoryDb } from './inventory-stock-db';
import { loginPassword } from './keycloak-admin-client';
import type { SeedConfig } from './seed-config';
import { resolveFixtureUser } from './seed-fixture-user-lookup';
import {
  SCENARIO_RESTAURANT_DESCRIPTION,
  SCENARIO_RESTAURANT_NAME,
  scenarioMenuItems,
} from './seed-scenario-fixtures';
import { type SeedState, saveState } from './seed-state-store';
import { type CreatedRestaurant, createRestaurant } from './seed-up-catalog';
import { runIdempotencyScenario } from './seed-up-scenario-idempotency';
import { runNoOversellScenario } from './seed-up-scenario-no-oversell';
import { runPartitioningScenario } from './seed-up-scenario-partitioning';
import { runSagaCompensationScenario } from './seed-up-scenario-saga-compensation';

async function runScenario(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.warn(`  ! scenario "${name}" failed: ${describeError(error)}`);
  }
}

async function createScenarioRestaurant(
  config: SeedConfig,
  state: SeedState,
  tenantId: string,
  items: ReturnType<typeof scenarioMenuItems>,
): Promise<CreatedRestaurant | null> {
  const ownerCreds = resolveFixtureUser(state, tenantId, 'restaurant-owner');
  if (!ownerCreds) {
    console.warn('  ! cannot resolve tenant restaurant-owner — skipping all scenarios');
    return null;
  }
  try {
    const ownerToken = await loginPassword(config, ownerCreds.username, ownerCreds.password);
    const ownerGateway = new GatewayClient(config.gatewayUrl, ownerToken);
    const created = await createRestaurant(
      ownerGateway,
      tenantId,
      state,
      SCENARIO_RESTAURANT_NAME,
      SCENARIO_RESTAURANT_DESCRIPTION,
      [items.compensation, items.idempotency, items.lowStock],
    );
    await withInventoryDb(config, async (client) => {
      await upsertStock(client, tenantId, created.menuItems[0].id, items.compensation.stockQty);
      await upsertStock(client, tenantId, created.menuItems[1].id, items.idempotency.stockQty);
      await upsertStock(client, tenantId, created.menuItems[2].id, items.lowStock.stockQty);
    });
    console.log(
      `  created scenario restaurant "${SCENARIO_RESTAURANT_NAME}" with 3 dedicated menu items`,
    );
    return created;
  } catch (error) {
    console.warn(
      `  ! could not create scenario restaurant/stock: ${describeError(error)} — skipping all scenarios`,
    );
    return null;
  }
}

export async function seedScenarios(config: SeedConfig, state: SeedState): Promise<void> {
  console.log('\n== Demo scenarios (saga compensation, idempotency, no-oversell, partitioning) ==');
  const tenant = state.tenants[0];
  if (!tenant) {
    console.warn('  ! no seeded tenant available — skipping all scenarios');
    return;
  }

  const items = scenarioMenuItems(config.paymentStubFailAtCents);
  const restaurant = await createScenarioRestaurant(config, state, tenant.id, items);
  if (!restaurant) return;
  await saveState(state);

  const customerCreds = resolveFixtureUser(state, tenant.id, 'customer');
  if (customerCreds) {
    const customerToken = await loginPassword(
      config,
      customerCreds.username,
      customerCreds.password,
    );
    const customerGateway = new GatewayClient(config.gatewayUrl, customerToken);

    await runScenario('saga compensation', () =>
      runSagaCompensationScenario(customerGateway, tenant.id, restaurant.menuItems[0].id, state),
    );
    await saveState(state);

    await runScenario('idempotency', () =>
      runIdempotencyScenario(customerGateway, tenant.id, restaurant.menuItems[1].id, state),
    );
    await saveState(state);

    await runScenario('no-oversell concurrency', () =>
      runNoOversellScenario(
        customerGateway,
        tenant.id,
        restaurant.menuItems[2].id,
        items.lowStock.stockQty,
        state,
      ),
    );
    await saveState(state);
  } else {
    console.warn(
      `  ! cannot resolve tenant customer for "${tenant.slug}" — skipping HTTP-driven scenarios`,
    );
  }

  const anyTenantUserId =
    state.users.find((user) => user.tenantId === tenant.id)?.keycloakUserId ??
    'seed-partition-demo-user';
  await runScenario('order partitioning', () =>
    runPartitioningScenario(
      config,
      state,
      tenant.id,
      anyTenantUserId,
      restaurant.id,
      restaurant.menuItems[0].id,
    ),
  );
  await saveState(state);

  console.log('== Demo scenarios complete ==');
}
