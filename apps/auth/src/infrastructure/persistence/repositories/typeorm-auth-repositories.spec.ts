import { randomUUID } from 'node:crypto';
import { ConflictError } from '@auth/domain/shared/errors';
import { Tenant } from '@auth/domain/tenant/tenant';
import { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';
import { TenantOrmEntity } from '@auth/infrastructure/persistence/entities/tenant.orm-entity';
import { UserTenantMapOrmEntity } from '@auth/infrastructure/persistence/entities/user-tenant-map.orm-entity';
import { TypeOrmTenantRepository } from '@auth/infrastructure/persistence/repositories/typeorm-tenant.repository';
import { TypeOrmUserTenantLinkRepository } from '@auth/infrastructure/persistence/repositories/typeorm-user-tenant-link.repository';
import {
  type AuthTestDatabase,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  truncateAuthTables,
} from '@auth/testing/auth-test-database';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

/**
 * Integration test: real Postgres via testcontainers, real migrated schema.
 * Exercises both auth repositories end-to-end (mappers round-trip through the
 * actual database + the migration's tables/constraints), rather than mocks.
 */
describe('auth TypeORM repositories (integration)', () => {
  let db: AuthTestDatabase;
  let tenantRepository: TypeOrmTenantRepository;
  let linkRepository: TypeOrmUserTenantLinkRepository;

  beforeAll(async () => {
    db = await startAuthTestDatabase();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TypeOrmTenantRepository,
        TypeOrmUserTenantLinkRepository,
        {
          provide: getRepositoryToken(TenantOrmEntity),
          useValue: db.dataSource.getRepository(TenantOrmEntity),
        },
        {
          provide: getRepositoryToken(UserTenantMapOrmEntity),
          useValue: db.dataSource.getRepository(UserTenantMapOrmEntity),
        },
      ],
    }).compile();

    tenantRepository = moduleRef.get(TypeOrmTenantRepository);
    linkRepository = moduleRef.get(TypeOrmUserTenantLinkRepository);
  }, 60000);

  afterAll(async () => {
    await stopAuthTestDatabase(db);
  });

  afterEach(async () => {
    await truncateAuthTables(db.dataSource);
  });

  it('persists a tenant and rehydrates it as a domain instance', async () => {
    const tenant = Tenant.create({ id: randomUUID(), name: 'Acme Foods', slug: 'acme-foods' });
    await tenantRepository.save(tenant);

    const byId = await tenantRepository.findById(tenant.id);
    expect(byId?.name).toBe('Acme Foods');

    const bySlug = await tenantRepository.findBySlug('acme-foods');
    expect(bySlug?.id).toBe(tenant.id);
  });

  it('maps the unique-slug violation to a domain ConflictError (→ HTTP 409, not 500)', async () => {
    await tenantRepository.save(Tenant.create({ id: randomUUID(), name: 'A', slug: 'dup' }));
    // A concurrent duplicate that races past the handler pre-check hits the unique
    // index; the repository must translate SQLSTATE 23505 into ConflictError so the
    // edge maps it to 409 rather than leaking a raw QueryFailedError as 500.
    await expect(
      tenantRepository.save(Tenant.create({ id: randomUUID(), name: 'B', slug: 'dup' })),
    ).rejects.toThrow(ConflictError);
  });

  it('paginates findAndCount ordered by createdAt desc', async () => {
    for (const slug of ['a', 'b', 'c']) {
      await tenantRepository.save(Tenant.create({ id: randomUUID(), name: slug, slug }));
    }
    const page1 = await tenantRepository.findAndCount({ page: 1, limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(3);
  });

  it('round-trips a user↔tenant link (FK + unique keycloak_user_id) via the map table', async () => {
    const tenant = Tenant.create({ id: randomUUID(), name: 'Acme', slug: 'acme' });
    await tenantRepository.save(tenant);

    const keycloakUserId = randomUUID();
    await linkRepository.save(
      UserTenantLink.create({
        id: randomUUID(),
        keycloakUserId,
        tenantId: tenant.id,
        role: 'restaurant-owner',
      }),
    );

    const found = await linkRepository.findByKeycloakUserId(keycloakUserId);
    expect(found?.tenantId).toBe(tenant.id);
    expect(found?.role).toBe('restaurant-owner');
  });

  it('rejects a link whose tenant_id violates the foreign key', async () => {
    await expect(
      linkRepository.save(
        UserTenantLink.create({
          id: randomUUID(),
          keycloakUserId: randomUUID(),
          tenantId: randomUUID(),
          role: 'customer',
        }),
      ),
    ).rejects.toThrow();
  });
});
