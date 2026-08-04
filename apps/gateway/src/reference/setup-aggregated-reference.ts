import { gatewaySessionOpenApi } from '@gateway/reference/gateway-session-openapi';
import type { INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';

export function setupAggregatedReference(app: INestApplication): void {
  const catalog = process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3001';
  const auth = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3002';
  const order = process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003';

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
