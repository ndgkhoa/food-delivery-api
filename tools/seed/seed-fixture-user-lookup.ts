import { TENANT_FIXTURES } from './demo-data-fixtures';
import type { SeedState } from './seed-state-store';

export interface ResolvedFixtureUser {
  username: string;
  password: string;
}

export function resolveFixtureUser(
  state: SeedState,
  tenantId: string,
  role: string,
): ResolvedFixtureUser | null {
  const tenant = state.tenants.find((t) => t.id === tenantId);
  const fixture = tenant && TENANT_FIXTURES.find((t) => t.slug === tenant.slug);
  const userFixture = fixture?.users.find((u) => u.role === role);
  if (!fixture || !userFixture) return null;
  return {
    username: `${fixture.usernamePrefix}-${userFixture.usernameSuffix}`,
    password: userFixture.password,
  };
}
