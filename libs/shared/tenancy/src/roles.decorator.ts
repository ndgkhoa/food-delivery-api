import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key under which `@Roles(...)` stores the required role list. */
export const REQUIRED_ROLES_METADATA = 'shared-tenancy:required-roles';

/**
 * Marks a route (or controller) as requiring at least one of the given roles.
 * `RolesGuard` reads this metadata and denies callers whose verified roles
 * (from the gateway-stamped `x-roles` header) do not intersect it. Absence of
 * the decorator leaves a route open to any authenticated tenant.
 */
export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES_METADATA, roles);
