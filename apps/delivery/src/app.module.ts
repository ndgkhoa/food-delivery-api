import { AssignDriverHandler } from '@delivery/application/assign-driver.handler';
import { GetAssignmentQuery } from '@delivery/application/get-assignment.query';
import { LocationUpdateHandler } from '@delivery/application/location-update.handler';
import { NearbyDriversQuery } from '@delivery/application/nearby-drivers.query';
import { deliveryEnvSchema } from '@delivery/config/delivery-env-schema';
import { ASSIGNMENT_STORE } from '@delivery/domain/delivery/assignment.store';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '@delivery/domain/delivery/driver-location.store';
import { RedisAssignmentStore } from '@delivery/infrastructure/redis/redis-assignment.store';
import { RedisClientModule } from '@delivery/infrastructure/redis/redis-client.module';
import { RedisDriverLocationStore } from '@delivery/infrastructure/redis/redis-driver-location.store';
import { DeliveryController } from '@delivery/interface/http/delivery.controller';
import { OrderEventsConsumer } from '@delivery/interface/messaging/order-events.consumer';
import { DeliveryGateway } from '@delivery/interface/ws/delivery.gateway';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { JwtVerificationModule } from '@food-delivery-api/shared-jwt';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  createKafkaClient,
  KAFKA_CLIENT,
  KafkaConsumerSubscriber,
} from '@food-delivery-api/shared-messaging';
import { TenancyModule, TrustedIdentityInterceptor } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    SharedConfigModule.forRoot(deliveryEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    TenancyModule,
    RedisClientModule,
    JwtVerificationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const issuer = `${config.getOrThrow<string>('KEYCLOAK_URL').replace(/\/$/, '')}/realms/${config.getOrThrow<string>('KEYCLOAK_REALM')}`;
        return {
          jwksUri: `${issuer}/protocol/openid-connect/certs`,
          issuer,
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
          clockToleranceSec: config.get<number>('JWT_CLOCK_TOLERANCE_SEC'),
        };
      },
    }),
  ],
  controllers: [DeliveryController],
  providers: [
    { provide: DRIVER_LOCATION_STORE, useClass: RedisDriverLocationStore },
    { provide: ASSIGNMENT_STORE, useClass: RedisAssignmentStore },
    LocationUpdateHandler,
    AssignDriverHandler,
    GetAssignmentQuery,
    {
      provide: NearbyDriversQuery,
      inject: [DRIVER_LOCATION_STORE, ConfigService],
      useFactory: (locations: DriverLocationStore, config: ConfigService) =>
        new NearbyDriversQuery(locations, config.getOrThrow<number>('NEARBY_RADIUS_M')),
    },
    DeliveryGateway,
    {
      provide: KAFKA_CLIENT,
      useFactory: (config: ConfigService) =>
        createKafkaClient({
          clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
          brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
        }),
      inject: [ConfigService],
    },
    KafkaConsumerSubscriber,
    OrderEventsConsumer,
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
  ],
})
export class AppModule {}
