import { CreateTenantHandler } from '@auth/application/tenant/commands/create-tenant.handler';
import { ProvisionUserHandler } from '@auth/application/tenant/commands/provision-user.handler';
import { GetTenantHandler } from '@auth/application/tenant/queries/get-tenant.handler';
import { ListTenantsHandler } from '@auth/application/tenant/queries/list-tenants.handler';
import type {
  CreateKeycloakUserInput,
  KeycloakAdminPort,
} from '@auth/domain/keycloak/keycloak-admin.port';
import { ConflictError, InvalidUuidError } from '@auth/domain/shared/errors';
import type { PageResult, Pagination } from '@auth/domain/shared/pagination';
import type { Tenant } from '@auth/domain/tenant/tenant';
import type { TenantRepository } from '@auth/domain/tenant/tenant.repository';
import type { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';
import type { UserTenantLinkRepository } from '@auth/domain/tenant/user-tenant-link.repository';

class FakeTenantRepository implements TenantRepository {
  private readonly rows = new Map<string, Tenant>();

  async save(tenant: Tenant): Promise<Tenant> {
    this.rows.set(tenant.id, tenant);
    return tenant;
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.rows.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return [...this.rows.values()].find((t) => t.slug === slug) ?? null;
  }

  async findAndCount(pagination: Pagination): Promise<PageResult<Tenant>> {
    const all = [...this.rows.values()];
    const start = (pagination.page - 1) * pagination.limit;
    return { data: all.slice(start, start + pagination.limit), total: all.length };
  }
}

class FakeUserTenantLinkRepository implements UserTenantLinkRepository {
  readonly saved: UserTenantLink[] = [];
  failOnSave = false;

  async save(link: UserTenantLink): Promise<UserTenantLink> {
    if (this.failOnSave) {
      throw new Error('simulated registry write failure');
    }
    this.saved.push(link);
    return link;
  }

  async findByKeycloakUserId(keycloakUserId: string): Promise<UserTenantLink | null> {
    return this.saved.find((l) => l.keycloakUserId === keycloakUserId) ?? null;
  }
}

class FakeKeycloakAdmin implements KeycloakAdminPort {
  readonly calls: CreateKeycloakUserInput[] = [];
  readonly deleted: string[] = [];
  nextUserId = 'kc-user-1';

  async createUser(input: CreateKeycloakUserInput): Promise<string> {
    this.calls.push(input);
    return this.nextUserId;
  }

  async deleteUser(userId: string): Promise<void> {
    this.deleted.push(userId);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('TenantHandlers', () => {
  let tenantRepository: FakeTenantRepository;
  let linkRepository: FakeUserTenantLinkRepository;
  let keycloakAdmin: FakeKeycloakAdmin;
  let createTenant: CreateTenantHandler;
  let provisionUser: ProvisionUserHandler;
  let getTenant: GetTenantHandler;
  let listTenants: ListTenantsHandler;

  beforeEach(() => {
    tenantRepository = new FakeTenantRepository();
    linkRepository = new FakeUserTenantLinkRepository();
    keycloakAdmin = new FakeKeycloakAdmin();
    createTenant = new CreateTenantHandler(tenantRepository);
    provisionUser = new ProvisionUserHandler(tenantRepository, linkRepository, keycloakAdmin);
    getTenant = new GetTenantHandler(tenantRepository);
    listTenants = new ListTenantsHandler(tenantRepository);
  });

  describe('create-tenant', () => {
    it('creates a tenant with a generated UUID id (source of the tenant_id claim)', async () => {
      const tenant = await createTenant.execute({ name: 'Acme', slug: 'acme' });

      expect(tenant.id).toMatch(UUID_PATTERN);
      expect(tenant.slug).toBe('acme');
      expect(await tenantRepository.findById(tenant.id)).not.toBeNull();
    });

    it('rejects a duplicate slug', async () => {
      await createTenant.execute({ name: 'Acme', slug: 'acme' });
      await expect(createTenant.execute({ name: 'Acme 2', slug: 'acme' })).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe('provision-user (proves M-2)', () => {
    it('sets a valid UUID tenant_id + role on the Keycloak user and records the link', async () => {
      const tenant = await createTenant.execute({ name: 'Acme', slug: 'acme' });

      const link = await provisionUser.execute({
        tenantId: tenant.id,
        username: 'olivia',
        email: 'olivia@acme.test',
        role: 'restaurant-owner',
        password: 'sup3r-secret',
      });

      expect(keycloakAdmin.calls).toHaveLength(1);
      const call = keycloakAdmin.calls[0];
      expect(call.tenantId).toBe(tenant.id);
      expect(call.tenantId).toMatch(UUID_PATTERN);
      expect(call.role).toBe('restaurant-owner');

      expect(link.keycloakUserId).toBe('kc-user-1');
      expect(link.tenantId).toBe(tenant.id);
      expect(link.role).toBe('restaurant-owner');
      expect(linkRepository.saved).toHaveLength(1);
    });

    it('compensates by deleting the Keycloak user when the registry write fails', async () => {
      const tenant = await createTenant.execute({ name: 'Acme', slug: 'acme' });
      linkRepository.failOnSave = true;

      await expect(
        provisionUser.execute({
          tenantId: tenant.id,
          username: 'olivia',
          email: 'olivia@acme.test',
          role: 'customer',
          password: 'sup3r-secret',
        }),
      ).rejects.toThrow();

      expect(keycloakAdmin.deleted).toEqual(['kc-user-1']);
      expect(linkRepository.saved).toHaveLength(0);
    });

    it('never persists the provisioning password on the registry link', async () => {
      const tenant = await createTenant.execute({ name: 'Acme', slug: 'acme' });
      const password = 'sup3r-secret';

      await provisionUser.execute({
        tenantId: tenant.id,
        username: 'olivia',
        email: 'olivia@acme.test',
        role: 'customer',
        password,
      });

      const serialized = JSON.stringify(linkRepository.saved[0]);
      expect(serialized).not.toContain(password);
      expect(serialized.toLowerCase()).not.toContain('password');
    });

    it('rejects a non-UUID tenantId before calling Keycloak (M-2 guard)', async () => {
      await expect(
        provisionUser.execute({
          tenantId: 'not-a-uuid',
          username: 'olivia',
          email: 'olivia@acme.test',
          role: 'restaurant-owner',
          password: 'sup3r-secret',
        }),
      ).rejects.toThrow(InvalidUuidError);

      expect(keycloakAdmin.calls).toHaveLength(0);
      expect(linkRepository.saved).toHaveLength(0);
    });

    it('404s a well-formed but unknown tenant id without calling Keycloak', async () => {
      await expect(
        provisionUser.execute({
          tenantId: '99999999-9999-4999-8999-999999999999',
          username: 'olivia',
          email: 'olivia@acme.test',
          role: 'customer',
          password: 'sup3r-secret',
        }),
      ).rejects.toThrow(/not found/i);
      expect(keycloakAdmin.calls).toHaveLength(0);
    });
  });

  describe('queries', () => {
    it('gets a tenant by id and 404s an unknown id', async () => {
      const tenant = await createTenant.execute({ name: 'Acme', slug: 'acme' });
      expect((await getTenant.execute(tenant.id)).id).toBe(tenant.id);
      await expect(getTenant.execute('99999999-9999-4999-8999-999999999999')).rejects.toThrow(
        /not found/i,
      );
    });

    it('lists tenants platform-wide with pagination metadata', async () => {
      await createTenant.execute({ name: 'A', slug: 'a' });
      await createTenant.execute({ name: 'B', slug: 'b' });

      const result = await listTenants.execute({ page: 1, limit: 20 });
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data).toHaveLength(2);
    });
  });
});
