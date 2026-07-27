import {
  INVENTORY_SERVICE_NAME,
  type InventoryGrpcService,
  type ReleaseRequest,
  type ReleaseResponse,
  type ReserveRequest,
  type ReserveResponse,
} from '@food-delivery-api/shared-contracts';
import { LockContentionError } from '@food-delivery-api/shared-locking';
import { status as GrpcStatus, type Metadata } from '@grpc/grpc-js';
import { ReleaseStockHandler } from '@inventory/application/reservation/commands/release-stock.handler';
import { ReserveStockHandler } from '@inventory/application/reservation/commands/reserve-stock.handler';
import {
  IdempotencyConflictError,
  InvalidReserveRequestError,
} from '@inventory/domain/shared/errors';
import { readTenantFromMetadata } from '@inventory/interface/grpc/read-tenant-from-metadata';
import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

/**
 * gRPC delivery edge for inventory. Reads the tenant from metadata (never the
 * request body), delegates to the reserve/release use cases, and maps domain
 * outcomes to gRPC status codes so callers can react (retry vs fail) instead of
 * seeing an opaque UNKNOWN. Thin: the no-oversell invariant lives in the DB +
 * the locked transaction, not here.
 */
@Controller()
export class InventoryGrpcController implements InventoryGrpcService {
  private readonly logger = new Logger(InventoryGrpcController.name);

  constructor(
    private readonly reserveStock: ReserveStockHandler,
    private readonly releaseStock: ReleaseStockHandler,
  ) {}

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'Reserve')
  async reserve(request: ReserveRequest, metadata?: Metadata): Promise<ReserveResponse> {
    try {
      const tenantId = readTenantFromMetadata(metadata);
      return await this.reserveStock.execute({
        tenantId,
        orderId: request.orderId,
        items: (request.items ?? []).map((item) => ({ itemId: item.itemId, qty: item.qty })),
      });
    } catch (error) {
      throw this.toRpcException(error);
    }
  }

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'Release')
  async release(request: ReleaseRequest, metadata?: Metadata): Promise<ReleaseResponse> {
    try {
      const tenantId = readTenantFromMetadata(metadata);
      return await this.releaseStock.execute({ tenantId, orderId: request.orderId });
    } catch (error) {
      throw this.toRpcException(error);
    }
  }

  private toRpcException(error: unknown): RpcException {
    if (error instanceof RpcException) {
      return error;
    }
    if (error instanceof InvalidReserveRequestError) {
      return new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: error.message });
    }
    if (error instanceof IdempotencyConflictError) {
      return new RpcException({ code: GrpcStatus.ALREADY_EXISTS, message: error.message });
    }
    // Lock contention is transient — tell the caller it's safe to retry.
    if (error instanceof LockContentionError) {
      return new RpcException({ code: GrpcStatus.ABORTED, message: error.message });
    }
    // Anything else is an unexpected fault: log it, but don't leak internals.
    this.logger.error(
      'Unexpected inventory error',
      error instanceof Error ? error.stack : String(error),
    );
    return new RpcException({ code: GrpcStatus.INTERNAL, message: 'Internal inventory error' });
  }
}
