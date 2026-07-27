import 'reflect-metadata';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { AppModule } from '@gateway/app.module';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Trust exactly ONE proxy hop — the Nginx edge that sits in front of the
  // gateway. Express then derives `req.ip` from the client's entry in the
  // `X-Forwarded-For` header Nginx sets, so the IP-keyed RateLimitGuard buckets
  // real client IPs instead of collapsing every caller onto Nginx's socket IP.
  // A single hop also means a client cannot spoof `req.ip` past Nginx — unlike
  // `trust proxy: true`, which trusts the whole (client-controllable) XFF chain.
  app.set('trust proxy', 1);

  // Generate/propagate x-correlation-id before pino-http reads it (see shared-logging).
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));

  // URI versioning under a global `api` prefix yields the `/api/v1` surface.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`gateway listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
