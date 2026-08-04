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
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    SharedConfigModule.forRoot(configEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    TenancyModule,
    PersistenceModule,
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
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
  ],
})
export class AppModule {}
