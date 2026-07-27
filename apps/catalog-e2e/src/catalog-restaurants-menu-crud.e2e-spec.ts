import 'reflect-metadata';
import {
  type CatalogTestDatabase,
  startCatalogTestDatabase,
  stopCatalogTestDatabase,
  truncateCatalogTables,
} from '@catalog/testing/catalog-test-database';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * Real end-to-end coverage of the catalog REST surface: a live Nest app
 * (full module graph, real ValidationPipe/interceptors) talking to a real,
 * migrated Postgres via testcontainers — no mocks.
 */
describe('Catalog REST API (e2e)', () => {
  let app: INestApplication;
  let db: CatalogTestDatabase;

  const tenantId = '33333333-3333-4333-8333-333333333333';
  const otherTenantId = '44444444-4444-4444-8444-444444444444';

  beforeAll(async () => {
    db = await startCatalogTestDatabase();

    process.env.DB_HOST = db.container.getHost();
    process.env.DB_PORT = String(db.container.getPort());
    process.env.DB_USERNAME = db.container.getUsername();
    process.env.DB_PASSWORD = db.container.getPassword();
    process.env.DB_NAME = db.container.getDatabase();
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'fatal';

    // Import AppModule AFTER env is set: @nestjs/config validates and bakes config when
    // ConfigModule.forRoot() runs, which happens at module-import time. A static top-of-file
    // import would run it before these testcontainers credentials exist in process.env.
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
      .set('x-tenant-id', tenantId)
      .send({ name: 'Pho 24' })
      .expect(201);

    const restaurantId = createRestaurantRes.body.id;
    expect(restaurantId).toBeDefined();

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set('x-tenant-id', tenantId)
      .send({ name: 'Pho Bo', priceCents: 8500 })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/restaurants')
      .set('x-tenant-id', tenantId)
      .expect(200);
    expect(listRes.body.data).toHaveLength(1);

    const menuListRes = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set('x-tenant-id', tenantId)
      .expect(200);
    expect(menuListRes.body.data).toHaveLength(1);
    expect(menuListRes.body.data[0].priceCents).toBe(8500);
  });

  it('rejects requests with no verified tenant identity (401)', async () => {
    // No gateway-stamped identity header → the trusted-identity interceptor fails
    // closed with 401 (unauthenticated), never trusting a client-supplied value.
    await request(app.getHttpServer()).get('/api/v1/restaurants').expect(401);
  });

  it('rejects an invalid create payload', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('x-tenant-id', tenantId)
      .send({ notAField: true })
      .expect(400);
  });

  it('soft-deletes a restaurant so it disappears from subsequent reads', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('x-tenant-id', tenantId)
      .send({ name: 'To Be Deleted' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${createRes.body.id}`)
      .set('x-tenant-id', tenantId)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${createRes.body.id}`)
      .set('x-tenant-id', tenantId)
      .expect(404);
  });

  it('rejects a whitespace-only restaurant name with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('x-tenant-id', tenantId)
      .send({ name: '   ' })
      .expect(400);
  });

  it('does not leak menu items across tenants', async () => {
    const createRestaurantRes = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('x-tenant-id', tenantId)
      .send({ name: 'Tenant A Kitchen' })
      .expect(201);
    const restaurantId = createRestaurantRes.body.id;

    const createMenuItemRes = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set('x-tenant-id', tenantId)
      .send({ name: 'Secret Pho', priceCents: 8500 })
      .expect(201);
    const menuItemId = createMenuItemRes.body.id;

    // Tenant B cannot resolve the parent restaurant, so it can neither list nor read the menu item.
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
      .set('x-tenant-id', tenantId)
      .send({ name: 'To Be Deleted With Items' })
      .expect(201);
    const restaurantId = createRestaurantRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set('x-tenant-id', tenantId)
      .send({ name: 'Doomed Dish', priceCents: 5000 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}`)
      .set('x-tenant-id', tenantId)
      .expect(204);

    // Parent 404s and its menu items no longer live as reachable rows.
    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/menu-items`)
      .set('x-tenant-id', tenantId)
      .expect(404);
  });

  it('does not leak restaurants across tenants', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('x-tenant-id', tenantId)
      .send({ name: 'Tenant Scoped Spot' })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/restaurants')
      .set('x-tenant-id', otherTenantId)
      .expect(200);

    expect(listRes.body.data).toHaveLength(0);
  });
});
