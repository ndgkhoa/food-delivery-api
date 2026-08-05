import {
  type ProvisionUserCommand,
  ProvisionUserHandler,
} from '@auth/application/tenant/commands/provision-user.handler';
import type {
  CreateKeycloakUserInput,
  KeycloakAdminPort,
} from '@auth/domain/keycloak/keycloak-admin.port';
import { EntityNotFoundError } from '@auth/domain/shared/errors';
import type { Tenant } from '@auth/domain/tenant/tenant';
import type { TenantRepository } from '@auth/domain/tenant/tenant.repository';
import { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';
import type { UserTenantLinkRepository } from '@auth/domain/tenant/user-tenant-link.repository';

const validTenantId = '11111111-1111-4111-8111-111111111111';

class FakeTenantRepository implements TenantRepository {
  private readonly tenant: Tenant | null;

  constructor(tenant: Tenant | null) {
    this.tenant = tenant;
  }

  async save(tenant: Tenant): Promise<Tenant> {
    return tenant;
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.tenant && this.tenant.id === id ? this.tenant : null;
  }

  async findBySlug(): Promise<Tenant | null> {
    return null;
  }

  async findAndCount(): Promise<{ data: Tenant[]; total: number }> {
    return { data: [], total: 0 };
  }
}

class FakeUserTenantLinkRepository implements UserTenantLinkRepository {
  saveImpl: (link: UserTenantLink) => Promise<UserTenantLink> = async (link) => link;
  saved: UserTenantLink[] = [];

  async save(link: UserTenantLink): Promise<UserTenantLink> {
    const result = await this.saveImpl(link);
    this.saved.push(result);
    return result;
  }

  async findByKeycloakUserId(): Promise<UserTenantLink | null> {
    return null;
  }
}

class FakeKeycloakAdminPort implements KeycloakAdminPort {
  createUserImpl: (input: CreateKeycloakUserInput) => Promise<string> = async () => 'kc-1';
  deleteUserImpl: (userId: string) => Promise<void> = async () => undefined;
  deletedUserIds: string[] = [];

  async createUser(input: CreateKeycloakUserInput): Promise<string> {
    return this.createUserImpl(input);
  }

  async deleteUser(userId: string): Promise<void> {
    this.deletedUserIds.push(userId);
    return this.deleteUserImpl(userId);
  }
}

function buildTenant(): Tenant {
  return { id: validTenantId } as unknown as Tenant;
}

function buildCommand(overrides: Partial<ProvisionUserCommand> = {}): ProvisionUserCommand {
  return {
    tenantId: validTenantId,
    username: 'olivia',
    email: 'olivia@acme.test',
    role: 'customer',
    password: 'sup3r-secret',
    ...overrides,
  };
}

function buildHandler(tenant: Tenant | null = buildTenant()) {
  const tenantRepository = new FakeTenantRepository(tenant);
  const userTenantLinkRepository = new FakeUserTenantLinkRepository();
  const keycloakAdmin = new FakeKeycloakAdminPort();
  const handler = new ProvisionUserHandler(
    tenantRepository,
    userTenantLinkRepository,
    keycloakAdmin,
  );
  return { tenantRepository, userTenantLinkRepository, keycloakAdmin, handler };
}

describe('ProvisionUserHandler', () => {
  it('rejects a malformed tenant id before touching any repository', async () => {
    const { handler } = buildHandler();

    await expect(handler.execute(buildCommand({ tenantId: 'not-a-uuid' }))).rejects.toThrow(
      /valid UUID/,
    );
  });

  it('rejects provisioning against a tenant that does not exist', async () => {
    const { handler } = buildHandler(null);

    await expect(handler.execute(buildCommand())).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('creates the Keycloak user then persists the tenant link on the happy path', async () => {
    const { handler, keycloakAdmin, userTenantLinkRepository } = buildHandler();
    keycloakAdmin.createUserImpl = async () => 'kc-42';

    const link = await handler.execute(buildCommand());

    expect(link.keycloakUserId).toBe('kc-42');
    expect(link.tenantId).toBe(validTenantId);
    expect(link.role).toBe('customer');
    expect(userTenantLinkRepository.saved).toHaveLength(1);
  });

  it('deletes the orphaned Keycloak user and rethrows the original error when the registry write fails', async () => {
    const { handler, keycloakAdmin, userTenantLinkRepository } = buildHandler();
    keycloakAdmin.createUserImpl = async () => 'kc-77';
    const registryError = new Error('registry unavailable');
    userTenantLinkRepository.saveImpl = async () => {
      throw registryError;
    };

    await expect(handler.execute(buildCommand())).rejects.toBe(registryError);
    expect(keycloakAdmin.deletedUserIds).toEqual(['kc-77']);
  });

  it('throws a reconciliation error when both the registry write and the compensating delete fail', async () => {
    const { handler, keycloakAdmin, userTenantLinkRepository } = buildHandler();
    keycloakAdmin.createUserImpl = async () => 'kc-99';
    userTenantLinkRepository.saveImpl = async () => {
      throw new Error('registry unavailable');
    };
    keycloakAdmin.deleteUserImpl = async () => {
      throw new Error('keycloak unreachable');
    };

    await expect(handler.execute(buildCommand())).rejects.toThrow(/manual reconciliation required/);
  });
});
