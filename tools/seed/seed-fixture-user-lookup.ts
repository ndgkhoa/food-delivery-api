import { TENANT_FIXTURES } from './demo-data-fixtures';
import type { SeedState } from './seed-state-store';

export interface ResolvedFixtureUser {
  username: string;
  password: string;
}

/**
 * Reconstructs a seeded user's login (username + fixture password) from the
 * deterministic fixtures — nothing is persisted in state. Shared by
 * `seed-down.ts` (re-login to cancel orders / delete catalog entries) and
 * `seed-up-scenarios.ts` (re-login as the already-provisioned tenant owner/
 * customer to drive the edge-case demo scenarios after the main tenant loop
 * has finished).
 */
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
