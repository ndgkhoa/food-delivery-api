import 'reflect-metadata';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@payment/app.module';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Payment is no longer headless: it exposes an HTTP surface (the HMAC-verified
 * provider webhook) AND, from the same Nest app, runs its Kafka command consumer,
 * the reply-outbox relay, and the Temporal worker (all started by their bootstrap
 * providers). `rawBody` is enabled so the webhook controller can HMAC-verify the
 * exact request bytes. Shutdown hooks stop the consumer, relay, worker, and close
 * the Temporal connection cleanly on SIGTERM/SIGINT.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3007;
  await app.listen(port);
  Logger.log(`payment listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error, 'Bootstrap');
  process.exit(1);
});
