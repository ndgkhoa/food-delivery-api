import {
  type CatalogTestDatabase,
  startCatalogTestDatabase,
  stopCatalogTestDatabase,
} from '@catalog/testing/catalog-test-database';
import { JWKS_KEY_RESOLVER, type JwksKeyResolver } from '@food-delivery-api/shared-auth';
import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';

export interface CatalogHandle {
  app: INestApplication;
  url: string;
  db: CatalogTestDatabase;
}

export interface GatewayHandle {
  app: INestApplication;
  url: string;
}

/** Boots a real catalog service (full module graph) on a testcontainers Postgres. */
export async function startCatalog(): Promise<CatalogHandle> {
  const db = await startCatalogTestDatabase();

  process.env.DB_HOST = db.container.getHost();
  process.env.DB_PORT = String(db.container.getPort());
  process.env.DB_USERNAME = db.container.getUsername();
  process.env.DB_PASSWORD = db.container.getPassword();
  process.env.DB_NAME = db.container.getDatabase();
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';

  const { AppModule } = await import('@catalog/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.listen(0);

  return { app, url: await app.getUrl(), db };
}

/**
 * Boots the gateway pointed at `catalogUrl` and a Keycloak base URL + realm
 * (issuer/JWKS are derived from these, matching the app's config). Pass
 * `keyResolver` to swap the remote JWKS for a local test key set (no live IdP);
 * omit it to verify against a real Keycloak reachable at `keycloakBaseUrl`.
 *
 * Rate limiting is OFF unless `rateLimit` is supplied, so the container-less
 * suites neither require Redis nor get throttled; the rate-limit e2e opts in
 * with a low `max` + a real Redis `url`.
 */
export async function startGateway(config: {
  catalogUrl: string;
  keycloakBaseUrl: string;
  realm: string;
  audience: string;
  keyResolver?: JwksKeyResolver;
  rateLimit?: { max: number; windowSec: number; redisUrl: string };
}): Promise<GatewayHandle> {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  process.env.CATALOG_SERVICE_URL = config.catalogUrl;
  process.env.KEYCLOAK_URL = config.keycloakBaseUrl;
  process.env.KEYCLOAK_REALM = config.realm;
  process.env.JWT_AUDIENCE = config.audience;

  if (config.rateLimit) {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_MAX = String(config.rateLimit.max);
    process.env.RATE_LIMIT_WINDOW_SEC = String(config.rateLimit.windowSec);
    process.env.REDIS_URL = config.rateLimit.redisUrl;
  } else {
    process.env.RATE_LIMIT_ENABLED = 'false';
  }

  const { AppModule } = await import('@gateway/app.module');
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (config.keyResolver) {
    builder.overrideProvider(JWKS_KEY_RESOLVER).useValue(config.keyResolver);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.listen(0);

  return { app, url: await app.getUrl() };
}

export async function stopCatalog(handle: CatalogHandle): Promise<void> {
  await handle.app.close();
  await stopCatalogTestDatabase(handle.db);
}
