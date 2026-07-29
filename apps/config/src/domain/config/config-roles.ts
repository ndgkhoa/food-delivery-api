/**
 * Role names this service checks on writes. `admin` may write only its own
 * tenant's override; writing the GLOBAL default (`tenant_id NULL`) requires
 * the platform-wide `platform-admin` role — a tenant admin must never be able
 * to change a default that affects every other tenant.
 */
const CONFIG_ADMIN_ROLE = 'admin';
export const CONFIG_PLATFORM_ADMIN_ROLE = 'platform-admin';

/** Either role may reach a write route; `UpsertConfigValueHandler`/`UpsertFeatureFlagHandler` enforce the stricter global-write rule beyond this. */
export const CONFIG_WRITE_ROLES = [CONFIG_ADMIN_ROLE, CONFIG_PLATFORM_ADMIN_ROLE] as const;
