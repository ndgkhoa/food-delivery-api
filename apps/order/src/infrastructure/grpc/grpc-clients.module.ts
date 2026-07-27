import {
  CATALOG_GRPC_PACKAGE,
  catalogProtoPath,
  INVENTORY_GRPC_PACKAGE,
  inventoryProtoPath,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

/** DI tokens for the two east-west gRPC clients order depends on. */
export const CATALOG_GRPC_CLIENT = Symbol('CatalogGrpcClient');
export const INVENTORY_GRPC_CLIENT = Symbol('InventoryGrpcClient');

/**
 * Registers the gRPC client channels order uses to reach catalog (menu
 * validation) and inventory (reserve/release). Both are internal-only
 * connections (never exposed via Nginx) — URLs come from config so they
 * differ between local dev and CI/test.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: CATALOG_GRPC_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC as const,
          options: {
            package: CATALOG_GRPC_PACKAGE,
            protoPath: catalogProtoPath(),
            url: config.getOrThrow<string>('CATALOG_GRPC_URL'),
            loader: PROTO_LOADER_OPTIONS,
          },
        }),
      },
      {
        name: INVENTORY_GRPC_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC as const,
          options: {
            package: INVENTORY_GRPC_PACKAGE,
            protoPath: inventoryProtoPath(),
            url: config.getOrThrow<string>('INVENTORY_GRPC_URL'),
            loader: PROTO_LOADER_OPTIONS,
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class GrpcClientsModule {}
