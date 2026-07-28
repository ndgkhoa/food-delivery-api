import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { LockingModule } from '@food-delivery-api/shared-locking';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  KafkaConsumerSubscriber,
  KafkaTopicAdmin,
  MessagingModule,
} from '@food-delivery-api/shared-messaging';
import { TenancyModule } from '@food-delivery-api/shared-tenancy';
import { ReleaseStockHandler } from '@inventory/application/reservation/commands/release-stock.handler';
import { ReserveStockHandler } from '@inventory/application/reservation/commands/reserve-stock.handler';
import { inventoryEnvSchema } from '@inventory/config/inventory-env-schema';
import { PersistenceModule } from '@inventory/infrastructure/persistence/persistence.module';
import { InventoryGrpcController } from '@inventory/interface/grpc/inventory.grpc.controller';
import { InventoryCommandConsumer } from '@inventory/interface/messaging/inventory-command.consumer';
import { InventoryOutboxRelayProvider } from '@inventory/interface/messaging/inventory-outbox-relay.provider';
import { Module } from '@nestjs/common';

/**
 * Composition root: wires ports (domain) to adapters (infrastructure), pulls in
 * the distributed-lock module (Redis) + tenancy (for the consume-time tenant
 * scope), and registers the reserve/release use cases, the gRPC controller
 * (used by order's manual cancel/release), and the Kafka messaging edge
 * (command consumer + reply outbox relay).
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(inventoryEnvSchema),
    SharedLoggingModule.forRoot(),
    PersistenceModule,
    LockingModule.forRoot(),
    TenancyModule,
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'inventory',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  controllers: [InventoryGrpcController],
  providers: [
    ReserveStockHandler,
    ReleaseStockHandler,
    // Kafka edge: subscriber/admin helpers + command consumer + reply relay
    KafkaConsumerSubscriber,
    KafkaTopicAdmin,
    InventoryCommandConsumer,
    InventoryOutboxRelayProvider,
  ],
})
export class AppModule {}
