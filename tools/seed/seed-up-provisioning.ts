import type { TenantFixture, UserFixture } from './demo-data-fixtures';
import { ApiError, type GatewayClient } from './gateway-api-client';
import { findUserIdByUsername, getKeycloakAdminToken } from './keycloak-admin-client';
import type { SeedConfig } from './seed-config';

export interface TenantResponse {
  id: string;
  slug: string;
  name: string;
}

interface ProvisionedUserResponse {
  keycloakUserId: string;
}

interface TenantListResponse {
  data: TenantResponse[];
  total: number;
}

export interface ProvisionedUser {
  keycloakUserId: string;
  username: string;
  password: string;
}

/** Looks up a tenant by slug through the paginated list — the only lookup the auth API exposes (no filter-by-slug). */
async function findTenantBySlug(
  gateway: GatewayClient,
  slug: string,
): Promise<TenantResponse | null> {
  const limit = 100;
  for (let page = 1; ; page += 1) {
    const result = await gateway.request<TenantListResponse>(
      `list tenants (page ${page})`,
      'GET',
      `/auth/tenants?page=${page}&limit=${limit}`,
    );
    const found = result.data.find((tenant) => tenant.slug === slug);
    if (found) return found;
    if (page * limit >= result.total) return null;
  }
}

/** Creates the tenant, or reuses the existing one on a 409 (slug already taken). */
export async function ensureTenant(
  gateway: GatewayClient,
  fixture: TenantFixture,
): Promise<TenantResponse> {
  try {
    return await gateway.request<TenantResponse>(
      `create tenant "${fixture.slug}"`,
      'POST',
      '/auth/tenants',
      { name: fixture.name, slug: fixture.slug },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      console.log(`    tenant "${fixture.slug}" already exists — reusing it`);
      const existing = await findTenantBySlug(gateway, fixture.slug);
      if (existing) return existing;
    }
    throw error;
  }
}

/** Provisions a user, or resolves the existing Keycloak id on a 409 (username already taken). */
export async function ensureProvisionedUser(
  gateway: GatewayClient,
  config: SeedConfig,
  tenantId: string,
  username: string,
  fixture: UserFixture,
): Promise<ProvisionedUser> {
  const email = `${username}@demo.food-delivery.test`;
  try {
    const provisioned = await gateway.request<ProvisionedUserResponse>(
      `provision user "${username}"`,
      'POST',
      `/auth/tenants/${tenantId}/users`,
      { username, email, role: fixture.role, password: fixture.password },
    );
    return { keycloakUserId: provisioned.keycloakUserId, username, password: fixture.password };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      console.log(`    user "${username}" already exists — looking up its Keycloak id`);
      const adminToken = await getKeycloakAdminToken(config);
      const existingId = await findUserIdByUsername(config, adminToken, username);
      if (existingId) return { keycloakUserId: existingId, username, password: fixture.password };
    }
    throw error;
  }
}
