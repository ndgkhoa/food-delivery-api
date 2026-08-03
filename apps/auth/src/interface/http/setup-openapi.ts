import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';

/**
 * Publishes the auth OpenAPI spec at `/api/v1/openapi.json` and a Scalar
 * reference UI at `/api/v1/reference`, mirroring the catalog service.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Auth Service API')
    .setDescription('Tenant registry + user provisioning for the food-delivery platform.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use('/api/v1/openapi.json', (_req: Request, res: Response) => {
    res.json(document);
  });
  app.use('/api/v1/reference', apiReference({ url: '/api/v1/openapi.json' }));
}
