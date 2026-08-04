import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  KafkaConsumerSubscriber,
  KafkaTopicAdmin,
  MessagingModule,
} from '@food-delivery-api/shared-messaging';
import { SettingsClientModule } from '@food-delivery-api/shared-settings';
import { TenancyModule, TrustedIdentityInterceptor } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { CancelOrderHandler } from '@order/application/order/commands/cancel-order.handler';
import { ConfirmOrderHandler } from '@order/application/order/commands/confirm-order.handler';
import { PlaceOrderHandler } from '@order/application/order/commands/place-order.handler';
import { GetOrderHandler } from '@order/application/order/queries/get-order.handler';
import { ListOrdersHandler } from '@order/application/order/queries/list-orders.handler';
import { HandleInventoryReplyHandler } from '@order/application/saga/handle-inventory-reply.handler';
import { HandlePaymentReplyHandler } from '@order/application/saga/handle-payment-reply.handler';
import { orderEnvSchema } from '@order/config/order-env-schema';
import { CATALOG_GATEWAY_PORT } from '@order/domain/shared/catalog-gateway.port';
import { INVENTORY_GATEWAY_PORT } from '@order/domain/shared/inventory-gateway.port';
import { CatalogGrpcAdapter } from '@order/infrastructure/grpc/catalog-grpc.adapter';
import { GrpcClientsModule } from '@order/infrastructure/grpc/grpc-clients.module';
import { InventoryGrpcAdapter } from '@order/infrastructure/grpc/inventory-grpc.adapter';
import { OrdersPartitionMaintenanceService } from '@order/infrastructure/persistence/partitioning/orders-partition-maintenance';
import { PersistenceModule } from '@order/infrastructure/persistence/persistence.module';
import { OrdersController } from '@order/interface/http/orders.controller';
import { SagaAdminController } from '@order/interface/http/saga-admin.controller';
import { InventoryReplyConsumer } from '@order/interface/messaging/inventory-reply.consumer';
import { OrderOutboxRelayProvider } from '@order/interface/messaging/order-outbox-relay.provider';
import { PaymentReplyConsumer } from '@order/interface/messaging/payment-reply.consumer';
import { SagaReaperProvider } from '@order/interface/messaging/saga-reaper.provider';

@Module({
  imports: [
    SharedConfigModule.forRoot(orderEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    PersistenceModule,
    TenancyModule,
    GrpcClientsModule,
    ScheduleModule.forRoot(),
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'order',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
    SettingsClientModule.forRoot({
      configServiceUrl: process.env.CONFIG_SERVICE_URL ?? 'http://localhost:3008',
      ttlMs: Number(process.env.CONFIG_CACHE_TTL_MS ?? 30_000),
      kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  controllers: [OrdersController, SagaAdminController],
  providers: [
    PlaceOrderHandler,
    CancelOrderHandler,
    ConfirmOrderHandler,
    GetOrderHandler,
    ListOrdersHandler,
    HandleInventoryReplyHandler,
    HandlePaymentReplyHandler,
    KafkaConsumerSubscriber,
    KafkaTopicAdmin,
    InventoryReplyConsumer,
    PaymentReplyConsumer,
    OrderOutboxRelayProvider,
    SagaReaperProvider,
    OrdersPartitionMaintenanceService,
    { provide: CATALOG_GATEWAY_PORT, useClass: CatalogGrpcAdapter },
    { provide: INVENTORY_GATEWAY_PORT, useClass: InventoryGrpcAdapter },
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
  ],
})
export class AppModule {}
