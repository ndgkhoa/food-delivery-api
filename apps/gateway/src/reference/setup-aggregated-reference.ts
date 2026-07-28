import type { INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';

/**
 * Aggregated Scalar reference at the gateway: a single UI at `/api/v1/reference`
 * that lists every downstream service's OpenAPI spec, so a client sees one entry
 * point instead of a doc per service port. The gateway owns no business routes
 * (it reverse-proxies), so this is a pure developer aid — Scalar fetches each
 * spec client-side from the service URLs (reachable on localhost in dev).
 *
 * Mounted via `app.use` (raw Express middleware), so it bypasses the global
 * JwtAuthGuard and the URI-versioning prefix — the reference must stay public.
 */
export function setupAggregatedReference(app: INestApplication): void {
  const catalog = process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3001';
  const auth = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3002';
  const order = process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003';

  app.use(
    '/api/v1/reference',
    apiReference({
      sources: [
        { title: 'Catalog', url: `${catalog}/api/v1/openapi.json` },
        { title: 'Auth', url: `${auth}/api/v1/openapi.json` },
        { title: 'Order', url: `${order}/api/v1/openapi.json` },
      ],
    }),
  );
}
