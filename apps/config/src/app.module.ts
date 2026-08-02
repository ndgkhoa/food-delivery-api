import { GetConfigValueHandler } from '@config/application/config/get-config-value.handler';
import { GetFeatureFlagHandler } from '@config/application/config/get-feature-flag.handler';
import { ListConfigValuesHandler } from '@config/application/config/list-config-values.handler';
import { UpsertConfigValueHandler } from '@config/application/config/upsert-config-value.handler';
import { UpsertFeatureFlagHandler } from '@config/application/config/upsert-feature-flag.handler';
import { configEnvSchema } from '@config/config/config-env-schema';
import { CONFIG_EVENT_PUBLISHER } from '@config/domain/config/config-event';
import { KafkaConfigEventPublisher } from '@config/infrastructure/messaging/config-event.publisher';
import { PersistenceModule } from '@config/infrastructure/persistence/persistence.module';
import { ConfigController } from '@config/interface/http/config.controller';
import { ConfigExceptionFilter } from '@config/interface/http/filters/config-exception.filter';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { MessagingModule } from '@food-delivery-api/shared-messaging';
import {
  RolesGuard,
  TenancyModule,
  TrustedIdentityInterceptor,
} from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

/**
 * Composition root: wires the domain repository/publisher ports to their
 * infrastructure adapters, registers the application use-case handlers, and
 * the HTTP controller. The only file allowed to import across every layer —
 * see the hexagonal rules in `.dependency-cruiser.js`.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(configEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    TenancyModule,
    PersistenceModule,
    // Producer-only: config never consumes its own `config.events` topic — the
    // shared config-client library (imported by every OTHER service) is the consumer.
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'config',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  controllers: [ConfigController],
  providers: [
    GetConfigValueHandler,
    ListConfigValuesHandler,
    UpsertConfigValueHandler,
    GetFeatureFlagHandler,
    UpsertFeatureFlagHandler,
    { provide: CONFIG_EVENT_PUBLISHER, useClass: KafkaConfigEventPublisher },
    // RBAC on `@Roles`-annotated write routes (admin/platform-admin). Runs
    // before the interceptor, mirroring catalog/media.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Every route is tenant-scoped by default — the tenant comes from the
    // verified identity the gateway propagates (shared-tenancy), never a raw client header.
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
    // Maps config domain errors to HTTP statuses so use cases stay transport-agnostic.
    { provide: APP_FILTER, useClass: ConfigExceptionFilter },
  ],
})
export class AppModule {}
