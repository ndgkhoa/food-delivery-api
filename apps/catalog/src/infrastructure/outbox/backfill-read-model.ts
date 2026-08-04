import 'dotenv/config';
import 'reflect-metadata';
import { buildDataSourceOptions } from '@catalog/infrastructure/persistence/typeorm-options';
import { DataSource } from 'typeorm';

async function backfill(): Promise<void> {
  const dataSource = new DataSource(
    buildDataSourceOptions({
      DB_HOST: process.env.DB_HOST ?? 'localhost',
      DB_PORT: Number(process.env.DB_PORT ?? 5432),
      DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
      DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
      DB_NAME: process.env.DB_NAME ?? 'catalog',
    }),
  );

  await dataSource.initialize();
  try {
    const restaurants = await dataSource.query(`
      INSERT INTO "outbox" (aggregatetype, aggregateid, type, payload, tenant_id, correlationid)
      SELECT 'catalog', r.id, 'RestaurantCreated',
        jsonb_build_object(
          'id', r.id, 'tenantId', r.tenant_id, 'name', r.name,
          'description', r.description, 'isActive', r.is_active,
          'createdAt', r.created_at, 'updatedAt', r.updated_at, 'deletedAt', null
        ),
        r.tenant_id, gen_random_uuid()
      FROM "restaurants" r
      WHERE r.deleted_at IS NULL
      RETURNING id
    `);

    const menuItems = await dataSource.query(`
      INSERT INTO "outbox" (aggregatetype, aggregateid, type, payload, tenant_id, correlationid)
      SELECT 'catalog', m.id, 'MenuItemCreated',
        jsonb_build_object(
          'id', m.id, 'tenantId', m.tenant_id, 'restaurantId', m.restaurant_id,
          'name', m.name, 'description', m.description, 'priceCents', m.price_cents,
          'isAvailable', m.is_available, 'createdAt', m.created_at,
          'updatedAt', m.updated_at, 'deletedAt', null
        ),
        m.tenant_id, gen_random_uuid()
      FROM "menu_items" m
      WHERE m.deleted_at IS NULL
      RETURNING id
    `);

    const restaurantCount = Array.isArray(restaurants) ? restaurants.length : 0;
    const menuItemCount = Array.isArray(menuItems) ? menuItems.length : 0;
    console.log(
      `Backfilled ${restaurantCount} restaurants + ${menuItemCount} menu items to outbox`,
    );
  } finally {
    await dataSource.destroy();
  }
}

backfill().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
