import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  KafkaConsumerSubscriber,
  KafkaTopicAdmin,
  MessagingModule,
} from '@food-delivery-api/shared-messaging';
import { TenancyModule, TrustedIdentityInterceptor } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { CancelOrderHandler } from '@order/application/order/commands/cancel-order.handler';
import { ConfirmOrderHandler } from '@order/application/order/commands/confirm-order.handler';
import { PlaceOrderHandler } from '@order/application/order/commands/place-order.handler';
import { GetOrderHandler } from '@order/application/order/queries/get-order.handler';
import { HandleInventoryReplyHandler } from '@order/application/saga/handle-inventory-reply.handler';
import { HandlePaymentReplyHandler } from '@order/application/saga/handle-payment-reply.handler';
import { orderEnvSchema } from '@order/config/order-env-schema';
import { CATALOG_GATEWAY_PORT } from '@order/domain/shared/catalog-gateway.port';
import { INVENTORY_GATEWAY_PORT } from '@order/domain/shared/inventory-gateway.port';
import { CatalogGrpcAdapter } from '@order/infrastructure/grpc/catalog-grpc.adapter';
import { GrpcClientsModule } from '@order/infrastructure/grpc/grpc-clients.module';
import { InventoryGrpcAdapter } from '@order/infrastructure/grpc/inventory-grpc.adapter';
import { PersistenceModule } from '@order/infrastructure/persistence/persistence.module';
import { OrderDomainErrorFilter } from '@order/interface/http/filters/order-domain-error.filter';
import { OrdersController } from '@order/interface/http/orders.controller';
import { InventoryReplyConsumer } from '@order/interface/messaging/inventory-reply.consumer';
import { OrderOutboxRelayProvider } from '@order/interface/messaging/order-outbox-relay.provider';
import { PaymentReplyConsumer } from '@order/interface/messaging/payment-reply.consumer';

/**
 * Composition root: wires ports (domain) to adapters (infrastructure),
 * registers application use-case + saga handlers, the HTTP controller, and the
 * Kafka messaging edge (outbox relay + reply consumers). This is the only file
 * allowed to import across all layers — see dependency-cruiser layer rules.
 *
 * The saga producer + reply consumers run over Kafka; the manual cancel path
 * still reaches inventory over gRPC (release), and catalog validation stays gRPC.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(orderEnvSchema),
    SharedLoggingModule.forRoot(),
    PersistenceModule,
    TenancyModule,
    GrpcClientsModule,
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'order',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  controllers: [OrdersController],
  providers: [
    // Order use cases
    PlaceOrderHandler,
    CancelOrderHandler,
    ConfirmOrderHandler,
    GetOrderHandler,
    // Saga transition handlers (driven by the reply consumers)
    HandleInventoryReplyHandler,
    HandlePaymentReplyHandler,
    // Kafka edge: subscriber/admin helpers + reply consumers + outbox relay
    KafkaConsumerSubscriber,
    KafkaTopicAdmin,
    InventoryReplyConsumer,
    PaymentReplyConsumer,
    OrderOutboxRelayProvider,
    // East-west gateways over gRPC (catalog validate; inventory release on cancel)
    { provide: CATALOG_GATEWAY_PORT, useClass: CatalogGrpcAdapter },
    { provide: INVENTORY_GATEWAY_PORT, useClass: InventoryGrpcAdapter },
    // Every route is tenant-scoped by default — the tenant comes from the verified identity
    // the gateway propagates (shared-tenancy), never from a raw client header. No RolesGuard:
    // ownership (owner or admin) is enforced in the handlers, not by a role requirement.
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
    // Maps order domain errors to their HTTP status so use cases stay transport-agnostic.
    { provide: APP_FILTER, useClass: OrderDomainErrorFilter },
  ],
})
export class AppModule {}
