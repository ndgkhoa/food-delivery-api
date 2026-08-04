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

export const CATALOG_GRPC_CLIENT = Symbol('CatalogGrpcClient');
export const INVENTORY_GRPC_CLIENT = Symbol('InventoryGrpcClient');

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
