import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';

export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Delivery Service API')
    .setDescription(
      'Nearby-driver lookup + order assignment. Live driver location is over WebSocket.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use('/api/v1/openapi.json', (_req: Request, res: Response) => {
    res.json(document);
  });
  app.use('/api/v1/reference', apiReference({ url: '/api/v1/openapi.json' }));
}
