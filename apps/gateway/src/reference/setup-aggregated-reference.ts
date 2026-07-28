import { gatewaySessionOpenApi } from '@gateway/reference/gateway-session-openapi';
import type { INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';

/**
 * Aggregated Scalar reference at the gateway: a single UI at `/api/v1/reference`
 * that lists the gateway's own session endpoints plus every downstream service's
 * OpenAPI spec, so a client sees one entry point instead of a doc per service
 * port. The gateway owns no business routes (it reverse-proxies), so this is a
 * pure developer aid — Scalar fetches each spec client-side (service URLs are
 * reachable on localhost in dev; the gateway serves its own session spec here).
 *
 * Mounted via `app.use` (raw Express middleware), so it bypasses the global
 * JwtAuthGuard and the URI-versioning prefix — the reference must stay public.
 */
export function setupAggregatedReference(app: INestApplication): void {
  const catalog = process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3001';
  const auth = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3002';
  const order = process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003';

  // The gateway's own session endpoints (token/refresh/logout) live on no
  // service, so serve their hand-written spec here for the aggregated view.
  app.use('/api/v1/openapi.json', (_req: Request, res: Response) => {
    res.json(gatewaySessionOpenApi);
  });

  app.use(
    '/api/v1/reference',
    apiReference({
      sources: [
        { title: 'Gateway (session)', url: '/api/v1/openapi.json' },
        { title: 'Catalog', url: `${catalog}/api/v1/openapi.json` },
        { title: 'Auth', url: `${auth}/api/v1/openapi.json` },
        { title: 'Order', url: `${order}/api/v1/openapi.json` },
      ],
    }),
  );
}
