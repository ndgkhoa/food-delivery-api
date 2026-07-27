import {
  INVENTORY_SERVICE_NAME,
  type InventoryGrpcService,
  type ReleaseRequest,
  type ReleaseResponse,
  type ReserveRequest,
  type ReserveResponse,
} from '@food-delivery-api/shared-contracts';
import type { Metadata } from '@grpc/grpc-js';
import { ReleaseStockHandler } from '@inventory/application/reservation/commands/release-stock.handler';
import { ReserveStockHandler } from '@inventory/application/reservation/commands/reserve-stock.handler';
import { readTenantFromMetadata } from '@inventory/interface/grpc/read-tenant-from-metadata';
import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';

/**
 * gRPC delivery edge for inventory. Reads the tenant from metadata (never the
 * request body), then delegates to the reserve/release use cases. Thin: no
 * business logic here — the no-oversell invariant lives in the domain + the
 * locked transaction in the application layer.
 */
@Controller()
export class InventoryGrpcController implements InventoryGrpcService {
  constructor(
    private readonly reserveStock: ReserveStockHandler,
    private readonly releaseStock: ReleaseStockHandler,
  ) {}

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'Reserve')
  reserve(request: ReserveRequest, metadata?: Metadata): Promise<ReserveResponse> {
    const tenantId = readTenantFromMetadata(metadata);
    return this.reserveStock.execute({
      tenantId,
      orderId: request.orderId,
      items: (request.items ?? []).map((item) => ({ itemId: item.itemId, qty: item.qty })),
    });
  }

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'Release')
  release(request: ReleaseRequest, metadata?: Metadata): Promise<ReleaseResponse> {
    const tenantId = readTenantFromMetadata(metadata);
    return this.releaseStock.execute({ tenantId, orderId: request.orderId });
  }
}
