import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { TenancyModule, TrustedIdentityInterceptor } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { CancelOrderHandler } from '@order/application/order/commands/cancel-order.handler';
import { ConfirmOrderHandler } from '@order/application/order/commands/confirm-order.handler';
import { PlaceOrderHandler } from '@order/application/order/commands/place-order.handler';
import { GetOrderHandler } from '@order/application/order/queries/get-order.handler';
import { orderEnvSchema } from '@order/config/order-env-schema';
import { CATALOG_GATEWAY_PORT } from '@order/domain/shared/catalog-gateway.port';
import { INVENTORY_GATEWAY_PORT } from '@order/domain/shared/inventory-gateway.port';
import { CatalogGrpcAdapter } from '@order/infrastructure/grpc/catalog-grpc.adapter';
import { GrpcClientsModule } from '@order/infrastructure/grpc/grpc-clients.module';
import { InventoryGrpcAdapter } from '@order/infrastructure/grpc/inventory-grpc.adapter';
import { PersistenceModule } from '@order/infrastructure/persistence/persistence.module';
import { OrderDomainErrorFilter } from '@order/interface/http/filters/order-domain-error.filter';
import { OrdersController } from '@order/interface/http/orders.controller';

/**
 * Composition root: wires ports (domain) to adapters (infrastructure),
 * registers application use-case handlers as providers, and registers the
 * HTTP controller (interface). This is the only file allowed to import
 * across all layers — see dependency-cruiser layer rules in
 * `.dependency-cruiser.js`.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(orderEnvSchema),
    SharedLoggingModule.forRoot(),
    PersistenceModule,
    TenancyModule,
    GrpcClientsModule,
  ],
  controllers: [OrdersController],
  providers: [
    // Order use cases
    PlaceOrderHandler,
    CancelOrderHandler,
    ConfirmOrderHandler,
    GetOrderHandler,
    // East-west gateways over gRPC
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
