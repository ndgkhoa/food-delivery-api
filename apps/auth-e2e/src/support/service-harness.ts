import {
  type AuthTestDatabase,
  startAuthTestDatabase,
  stopAuthTestDatabase,
} from '@auth/testing/auth-test-database';
import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';

export interface AuthHandle {
  app: INestApplication;
  url: string;
  db: AuthTestDatabase;
}

export interface GatewayHandle {
  app: INestApplication;
  url: string;
}

/**
 * Boots a real auth service (full module graph) on a testcontainers Postgres,
 * pointed at a real Keycloak for provisioning. Mirrors the catalog harness in
 * apps/gateway-e2e/src/support/service-harness.ts.
 */
export async function startAuth(config: {
  keycloakBaseUrl: string;
  realm: string;
}): Promise<AuthHandle> {
  const db = await startAuthTestDatabase();

  process.env.DB_HOST = db.container.getHost();
  process.env.DB_PORT = String(db.container.getPort());
  process.env.DB_USERNAME = db.container.getUsername();
  process.env.DB_PASSWORD = db.container.getPassword();
  process.env.DB_NAME = db.container.getDatabase();
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  process.env.KEYCLOAK_URL = config.keycloakBaseUrl;
  process.env.KEYCLOAK_REALM = config.realm;
  process.env.KEYCLOAK_ADMIN = 'admin';
  process.env.KEYCLOAK_ADMIN_PASSWORD = 'admin';

  const { AppModule } = await import('@auth/app.module');
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
 * Boots the gateway pointed at the auth service + a real Keycloak (issuer/JWKS
 * derived from KEYCLOAK_URL + realm). Verifies real Keycloak tokens against live
 * JWKS and forwards `/api/v1/auth/*` to the auth service with trusted headers.
 */
export async function startGateway(config: {
  authUrl: string;
  keycloakBaseUrl: string;
  realm: string;
  audience: string;
}): Promise<GatewayHandle> {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  // Catalog URL is required by the gateway schema even though this e2e only hits auth.
  process.env.CATALOG_SERVICE_URL = config.authUrl;
  process.env.AUTH_SERVICE_URL = config.authUrl;
  process.env.KEYCLOAK_URL = config.keycloakBaseUrl;
  process.env.KEYCLOAK_REALM = config.realm;
  process.env.JWT_AUDIENCE = config.audience;

  const { AppModule } = await import('@gateway/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

export async function stopAuth(handle: AuthHandle): Promise<void> {
  await handle.app.close();
  await stopAuthTestDatabase(handle.db);
}
