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
