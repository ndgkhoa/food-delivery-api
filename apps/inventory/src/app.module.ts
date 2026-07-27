import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { LockingModule } from '@food-delivery-api/shared-locking';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { ReleaseStockHandler } from '@inventory/application/reservation/commands/release-stock.handler';
import { ReserveStockHandler } from '@inventory/application/reservation/commands/reserve-stock.handler';
import { inventoryEnvSchema } from '@inventory/config/inventory-env-schema';
import { PersistenceModule } from '@inventory/infrastructure/persistence/persistence.module';
import { InventoryGrpcController } from '@inventory/interface/grpc/inventory.grpc.controller';
import { Module } from '@nestjs/common';

/**
 * Composition root: wires ports (domain) to adapters (infrastructure), pulls in
 * the distributed-lock module (Redis), and registers the reserve/release use
 * cases + the gRPC controller. Inventory is gRPC-only — no HTTP controllers,
 * no tenant HTTP interceptor (tenant comes from gRPC metadata at the edge).
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(inventoryEnvSchema),
    SharedLoggingModule.forRoot(),
    PersistenceModule,
    LockingModule.forRoot(),
  ],
  controllers: [InventoryGrpcController],
  providers: [ReserveStockHandler, ReleaseStockHandler],
})
export class AppModule {}
