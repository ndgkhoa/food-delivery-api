/**
 * Env-driven config for the demo-data seeder. Defaults mirror `.env.example`
 * so the seeder works out of the box against the local dev stack started via
 * `docker compose --env-file .env -f infra/docker-compose.yml ...` + `pnpm dev`.
 *
 * Two DIFFERENT admin identities are involved, and it's easy to conflate them:
 *  - `bootstrapAdmin*` — the realm-seeded APPLICATION admin (`admin-user` /
 *    `admin-pass`, realm role `admin`) from `infra/keycloak/realm-export.json`.
 *    Used to call the auth service's `POST /tenants` (which requires
 *    `@Roles('admin')`).
 *  - `keycloakAdmin*` — the KEYCLOAK SERVER bootstrap admin in the `master`
 *    realm (`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`). Used for direct
 *    Keycloak Admin REST calls (user lookup on conflict, user deletion on
 *    teardown) — the same pattern the auth service's own
 *    `KeycloakAdminHttpAdapter` uses.
 *
 * `redisUrl` and the `minio*`/`mediaBucket` fields back two more direct-infra
 * carve-outs (driver GEO positions, media object teardown) alongside the
 * existing inventory-stock one — see `redis-driver-geo.ts` and
 * `minio-media-store.ts`. Defaults mirror the delivery/media services' own
 * env schemas (`REDIS_URL` is the shared `core` instance across services).
 *
 * `orderDbName` backs the order-partitioning demo scenario's direct-DB
 * carve-out (`order-db.ts`) — mirrors `DB_NAME`'s default in
 * `apps/order/src/config/order-env-schema.ts`. `paymentStubFailAtCents`
 * mirrors `PAYMENT_STUB_FAIL_AT_CENTS`'s default in
 * `apps/payment/src/config/payment-env-schema.ts`: the saga-compensation
 * scenario solves a menu item price so an order totals EXACTLY this amount,
 * so it MUST read the same value the payment service is actually running
 * with (a deployment that overrides the env var still gets a correct demo).
 */
export interface SeedConfig {
  gatewayUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakSpaClientId: string;
  keycloakAdminUsername: string;
  keycloakAdminPassword: string;
  bootstrapAdminUsername: string;
  bootstrapAdminPassword: string;
  dbHost: string;
  dbPort: number;
  dbUsername: string;
  dbPassword: string;
  inventoryDbName: string;
  mediaDbName: string;
  orderDbName: string;
  redisUrl: string;
  minioEndpoint: string;
  minioPort: number;
  minioAccessKey: string;
  minioSecretKey: string;
  minioUseSsl: boolean;
  mediaBucket: string;
  paymentStubFailAtCents: number;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value?.trim() ? value.trim() : fallback;
}

export function loadSeedConfig(): SeedConfig {
  return {
    gatewayUrl: env('GATEWAY_URL', 'http://localhost:3000/api/v1'),
    keycloakUrl: env('KEYCLOAK_URL', 'http://localhost:8080'),
    keycloakRealm: env('KEYCLOAK_REALM', 'food-delivery'),
    keycloakSpaClientId: env('KEYCLOAK_SPA_CLIENT_ID', 'food-delivery-spa'),
    keycloakAdminUsername: env('KEYCLOAK_ADMIN', 'admin'),
    keycloakAdminPassword: env('KEYCLOAK_ADMIN_PASSWORD', 'abc123456'),
    bootstrapAdminUsername: env('SEED_BOOTSTRAP_ADMIN_USERNAME', 'admin-user'),
    bootstrapAdminPassword: env('SEED_BOOTSTRAP_ADMIN_PASSWORD', 'admin-pass'),
    dbHost: env('DB_HOST', 'localhost'),
    dbPort: Number(env('DB_PORT', '5432')),
    dbUsername: env('DB_USERNAME', 'postgres'),
    dbPassword: env('DB_PASSWORD', 'abc123456'),
    inventoryDbName: env('INVENTORY_DB_NAME', 'inventory'),
    mediaDbName: env('MEDIA_DB_NAME', 'media'),
    orderDbName: env('ORDER_DB_NAME', 'order'),
    redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
    minioEndpoint: env('MINIO_ENDPOINT', 'localhost'),
    minioPort: Number(env('MINIO_PORT', '9000')),
    minioAccessKey: env('MINIO_ACCESS_KEY', 'minioadmin'),
    minioSecretKey: env('MINIO_SECRET_KEY', 'minioadmin'),
    minioUseSsl: env('MINIO_USE_SSL', 'false') === 'true',
    mediaBucket: env('MEDIA_BUCKET', 'media'),
    paymentStubFailAtCents: Number(env('PAYMENT_STUB_FAIL_AT_CENTS', '66600')),
  };
}
