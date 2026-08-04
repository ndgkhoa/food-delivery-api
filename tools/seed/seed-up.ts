import { TENANT_FIXTURES, type TenantFixture } from './demo-data-fixtures';
import { describeError, GatewayClient } from './gateway-api-client';
import { loginPassword } from './keycloak-admin-client';
import type { SeedConfig } from './seed-config';
import { createEmptyState, type SeedState, saveState } from './seed-state-store';
import { type CreatedRestaurant, createRestaurant } from './seed-up-catalog';
import { seedDriverLocation } from './seed-up-delivery';
import { uploadDemoMedia } from './seed-up-media';
import { ensureProvisionedUser, ensureTenant, type ProvisionedUser } from './seed-up-provisioning';
import { submitDemoReviews } from './seed-up-reviews';
import { seedScenarios } from './seed-up-scenarios';
import { placeDemoOrders, seedTenantConfig, seedTenantStock } from './seed-up-tenant-steps';

function printSummary(state: SeedState): void {
  console.log(`  tenants:            ${state.tenants.length}`);
  console.log(`  users:              ${state.users.length}`);
  console.log(`  restaurants:        ${state.restaurants.length}`);
  console.log(
    `  menu items:         ${state.restaurants.reduce((sum, r) => sum + r.menuItems.length, 0)}`,
  );
  console.log(`  config values:      ${state.configValues.length}`);
  console.log(`  stock rows:         ${state.stock.length}`);
  console.log(`  driver locations:   ${state.driverLocations.length}`);
  console.log(`  media objects:      ${state.media.length}`);
  console.log(`  orders:             ${state.orders.length}`);
  console.log(`  reviews:            ${state.reviews.length}`);
  console.log(`  partition-demo orders: ${state.partitionDemoOrders.length}`);
  console.log(`  partitions created: ${state.partitionsCreated.length}`);
}

async function seedTenant(
  config: SeedConfig,
  gateway: GatewayClient,
  fixture: TenantFixture,
  state: SeedState,
  tenantIndex: number,
  shouldPlaceDemoOrders: boolean,
): Promise<void> {
  console.log(`\n[tenant] "${fixture.slug}"`);
  const tenant = await ensureTenant(gateway, fixture);
  state.tenants.push({ id: tenant.id, slug: tenant.slug, name: tenant.name });

  console.log(`  provisioning ${fixture.users.length} users...`);
  const usersByRole = new Map<string, ProvisionedUser>();
  for (const userFixture of fixture.users) {
    const username = `${fixture.usernamePrefix}-${userFixture.usernameSuffix}`;
    const provisioned = await ensureProvisionedUser(
      gateway,
      config,
      tenant.id,
      username,
      userFixture,
    );
    state.users.push({
      keycloakUserId: provisioned.keycloakUserId,
      tenantId: tenant.id,
      username,
      role: userFixture.role,
    });
    usersByRole.set(userFixture.role, provisioned);
  }
  await saveState(state);

  // Driver GEO locations go in BEFORE any order is placed, so the delivery
  // service's online roster already has a candidate the moment a later order
  // saga confirms.
  const driver = usersByRole.get('driver');
  if (driver) {
    await seedDriverLocation(config, driver, tenant.id, tenantIndex, state);
    await saveState(state);
  }

  const owner = usersByRole.get('restaurant-owner');
  if (!owner)
    throw new Error(`tenant "${fixture.slug}" fixture is missing a restaurant-owner user`);
  const ownerToken = await loginPassword(config, owner.username, owner.password);
  const ownerGateway = new GatewayClient(config.gatewayUrl, ownerToken);

  console.log(`  creating ${fixture.restaurants.length} restaurants...`);
  const createdRestaurants: CreatedRestaurant[] = [];
  for (const restaurantFixture of fixture.restaurants) {
    createdRestaurants.push(
      await createRestaurant(
        ownerGateway,
        tenant.id,
        state,
        restaurantFixture.name,
        restaurantFixture.description,
        restaurantFixture.menuItems,
      ),
    );
    await saveState(state);
  }

  const admin = usersByRole.get('admin');
  if (admin) {
    await seedTenantConfig(config, admin, tenant.id, state);
    await saveState(state);
  }

  await seedTenantStock(config, tenant.id, fixture, createdRestaurants);

  // Media upload as the owner (the restaurant's manager) — independent of
  // the order flow, so it runs for every tenant.
  await uploadDemoMedia(
    ownerGateway,
    tenant.id,
    state,
    fixture.restaurants[0]?.name ?? fixture.slug,
    tenantIndex,
  );
  await saveState(state);

  if (shouldPlaceDemoOrders) {
    const customer = usersByRole.get('customer');
    if (!customer) throw new Error(`tenant "${fixture.slug}" fixture is missing a customer user`);
    const { orderIds, customerGateway } = await placeDemoOrders(
      config,
      customer,
      tenant.id,
      createdRestaurants[0],
      state,
    );
    await saveState(state);

    await submitDemoReviews(customerGateway, tenant.id, orderIds, state);
    await saveState(state);
  }
}

export async function seedUp(config: SeedConfig): Promise<void> {
  const state = createEmptyState();
  console.log('== Demo data seeder: up ==');
  console.log('Logging in as bootstrap admin...');
  const adminToken = await loginPassword(
    config,
    config.bootstrapAdminUsername,
    config.bootstrapAdminPassword,
  );
  const gateway = new GatewayClient(config.gatewayUrl, adminToken);

  for (const [index, fixture] of TENANT_FIXTURES.entries()) {
    try {
      // Demo orders (and their reviews) are placed only for the first tenant —
      // keeps the saga/event fan-out demoable without doubling the async
      // traffic the seeder waits on. Driver GEO + media are seeded for every
      // tenant since neither depends on the order saga.
      await seedTenant(config, gateway, fixture, state, index, index === 0);
    } catch (error) {
      await saveState(state);
      console.error(`\nFAILED while seeding tenant "${fixture.slug}": ${describeError(error)}`);
      console.error(
        'Partial progress was saved to .seed-state.json — inspect it, then run seed:down to clean up.',
      );
      throw error;
    }
  }

  await saveState(state);

  // Runs after every tenant is seeded (needs tenant 0's config already in
  // place) and is entirely best-effort — a failure here never fails `seed:up`
  // itself, since the main demo data is already committed at this point.
  try {
    await seedScenarios(config, state);
  } catch (error) {
    console.error(`\nDemo scenarios failed: ${describeError(error)}`);
  } finally {
    await saveState(state);
  }

  console.log('\n== Seed complete ==');
  printSummary(state);
  console.log('\nState written to tools/seed/.seed-state.json');
}
