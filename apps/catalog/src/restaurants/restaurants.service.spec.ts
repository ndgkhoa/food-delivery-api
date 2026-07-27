import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/audit-log.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  type CatalogTestDatabase,
  startCatalogTestDatabase,
  stopCatalogTestDatabase,
  truncateCatalogTables,
} from '../testing/catalog-test-database';
import { Restaurant } from './entities/restaurant.entity';
import { RestaurantsService } from './restaurants.service';

describe('RestaurantsService', () => {
  let db: CatalogTestDatabase;
  let service: RestaurantsService;
  let tenantContext: TenantContextService;
  let auditRepository: Repository<AuditLog>;

  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    db = await startCatalogTestDatabase();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RestaurantsService,
        AuditService,
        TenantContextService,
        {
          provide: getRepositoryToken(Restaurant),
          useValue: db.dataSource.getRepository(Restaurant),
        },
        { provide: getRepositoryToken(AuditLog), useValue: db.dataSource.getRepository(AuditLog) },
      ],
    }).compile();

    service = moduleRef.get(RestaurantsService);
    tenantContext = moduleRef.get(TenantContextService);
    auditRepository = db.dataSource.getRepository(AuditLog);
  }, 60000);

  afterAll(async () => {
    await stopCatalogTestDatabase(db);
  });

  afterEach(async () => {
    await truncateCatalogTables(db.dataSource);
  });

  function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId, actor: 'test-suite' }, fn);
  }

  it('creates a restaurant scoped to the calling tenant and writes an audit row', async () => {
    const restaurant = await asTenant(tenantA, () => service.create({ name: 'Pho House' }));

    expect(restaurant.id).toBeDefined();
    expect(restaurant.tenantId).toBe(tenantA);

    const auditRows = await auditRepository.find();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'CREATE',
      entity: 'restaurant',
      entityId: restaurant.id,
      tenantId: tenantA,
    });
  });

  it('excludes soft-deleted restaurants from findAll and findOne', async () => {
    const restaurant = await asTenant(tenantA, () => service.create({ name: 'Banh Mi Corner' }));
    await asTenant(tenantA, () => service.remove(restaurant.id));

    const list = await asTenant(tenantA, () => service.findAll({ page: 1, limit: 20 }));
    expect(list.data.find((r) => r.id === restaurant.id)).toBeUndefined();

    await expect(asTenant(tenantA, () => service.findOne(restaurant.id))).rejects.toThrow(
      /not found/i,
    );

    const deleteAuditRow = await auditRepository.findOne({
      where: { entityId: restaurant.id, action: 'DELETE' as never },
    });
    expect(deleteAuditRow).not.toBeNull();
  });

  it("does not allow one tenant to read another tenant's restaurant", async () => {
    const restaurant = await asTenant(tenantA, () => service.create({ name: 'Tenant A Only' }));

    await expect(asTenant(tenantB, () => service.findOne(restaurant.id))).rejects.toThrow(
      /not found/i,
    );

    const listForB = await asTenant(tenantB, () => service.findAll({ page: 1, limit: 20 }));
    expect(listForB.data).toHaveLength(0);
  });

  it('records a before/after snapshot on update', async () => {
    const restaurant = await asTenant(tenantA, () => service.create({ name: 'Original Name' }));
    const updated = await asTenant(tenantA, () =>
      service.update(restaurant.id, { name: 'Updated Name' }),
    );

    expect(updated.name).toBe('Updated Name');

    const updateAuditRow = await auditRepository.findOne({
      where: { entityId: restaurant.id, action: 'UPDATE' as never },
    });
    expect(updateAuditRow?.before).toMatchObject({ name: 'Original Name' });
    expect(updateAuditRow?.after).toMatchObject({ name: 'Updated Name' });
  });
});
