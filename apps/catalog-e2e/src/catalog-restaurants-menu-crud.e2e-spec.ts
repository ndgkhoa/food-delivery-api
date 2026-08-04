import 'reflect-metadata';
import {
  type CatalogTestDatabase,
  startCatalogTestDatabase,
  stopCatalogTestDatabase,
  syncReadModelFromWriteModel,
  truncateCatalogTables,
} from '@catalog/testing/catalog-test-database';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

describe('Catalog REST API (e2e)', () => {
  let app: INestApplication;
  let db: CatalogTestDatabase;

  const tenantId = '33333333-3333-4333-8333-333333333333';
  const otherTenantId = '44444444-4444-4444-8444-444444444444';
  const ownerHeaders = {
    'x-tenant-id': tenantId,
    'x-user-id': 'owner-1',
    'x-roles': 'restaurant-owner',
  };

  beforeAll(async () => {
    db = await startCatalogTestDatabase();

    process.env.DB_HOST = db.container.getHost();
    process.env.DB_PORT = String(db.container.getPort());
    process.env.DB_USERNAME = db.container.getUsername();
    process.env.DB_PASSWORD = db.container.getPassword();
    process.env.DB_NAME = db.container.getDatabase();
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'fatal';

    const { AppModule } = await import('@catalog/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app.close();
    await stopCatalogTestDatabase(db);
  });

  afterEach(async () => {
    await truncateCatalogTables(db.dataSource);
  });

  it('creates a restaurant, nests a menu item under it, and lists both', async () => {
    const createRestaurantRes = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set(ownerHeaders)
      .send({ name: 'Pho 24' })
      .expect(201);

    const restaurantId = createRestaurantRes.body.id;
    expect(restaurantId).toBeDefined();

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set(ownerHeaders)
      .send({ name: 'Pho Bo', priceCents: 8500 })
      .expect(201);

    await syncReadModelFromWriteModel(db.dataSource);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/restaurants')
      .set(ownerHeaders)
      .expect(200);
    expect(listRes.body.data).toHaveLength(1);

    const menuListRes = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set(ownerHeaders)
      .expect(200);
    expect(menuListRes.body.data).toHaveLength(1);
    expect(menuListRes.body.data[0].priceCents).toBe(8500);
  });

  it('rejects requests with no verified tenant identity (401)', async () => {
    await request(app.getHttpServer()).get('/api/v1/restaurants').expect(401);
  });

  it('rejects an invalid create payload', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set(ownerHeaders)
      .send({ notAField: true })
      .expect(400);
  });

  it('soft-deletes a restaurant so it disappears from subsequent reads', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set(ownerHeaders)
      .send({ name: 'To Be Deleted' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${createRes.body.id}`)
      .set(ownerHeaders)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${createRes.body.id}`)
      .set(ownerHeaders)
      .expect(404);
  });

  it('rejects a whitespace-only restaurant name with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set(ownerHeaders)
      .send({ name: '   ' })
      .expect(400);
  });

  it('does not leak menu items across tenants', async () => {
    const createRestaurantRes = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set(ownerHeaders)
      .send({ name: 'Tenant A Kitchen' })
      .expect(201);
    const restaurantId = createRestaurantRes.body.id;

    const createMenuItemRes = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set(ownerHeaders)
      .send({ name: 'Secret Pho', priceCents: 8500 })
      .expect(201);
    const menuItemId = createMenuItemRes.body.id;

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set('x-tenant-id', otherTenantId)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menu-items/${menuItemId}`)
      .set('x-tenant-id', otherTenantId)
      .expect(404);
  });

  it('cascades a soft-delete to menu items when a restaurant is deleted', async () => {
    const createRestaurantRes = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set(ownerHeaders)
      .send({ name: 'To Be Deleted With Items' })
      .expect(201);
    const restaurantId = createRestaurantRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set(ownerHeaders)
      .send({ name: 'Doomed Dish', priceCents: 5000 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}`)
      .set(ownerHeaders)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set(ownerHeaders)
      .expect(404);
  });

  it('does not leak restaurants across tenants', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set(ownerHeaders)
      .send({ name: 'Tenant Scoped Spot' })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/restaurants')
      .set('x-tenant-id', otherTenantId)
      .expect(200);

    expect(listRes.body.data).toHaveLength(0);
  });

  it('forbids a write from a verified identity without a catalog-write role (403)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set({ 'x-tenant-id': tenantId, 'x-user-id': 'cust-1', 'x-roles': 'customer' })
      .send({ name: 'Should Not Exist' })
      .expect(403);
  });

  it('rejects a write with a tenant header but no verified subject (401)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('x-tenant-id', tenantId)
      .send({ name: 'Should Not Exist' })
      .expect(401);
  });
});
