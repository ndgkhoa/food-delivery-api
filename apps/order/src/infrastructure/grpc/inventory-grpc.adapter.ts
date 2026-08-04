import {
  INVENTORY_SERVICE_NAME,
  type ReleaseRequest,
  type ReleaseResponse,
  type ReserveRequest,
  type ReserveResponse,
} from '@food-delivery-api/shared-contracts';
import { status as GrpcStatus, type Metadata } from '@grpc/grpc-js';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import {
  IdempotencyConflictError,
  OrderConcurrencyConflictError,
} from '@order/domain/shared/errors';
import type {
  InventoryGatewayPort,
  ReleaseOutcome,
  ReserveItemCommand,
  ReserveOutcome,
} from '@order/domain/shared/inventory-gateway.port';
import { buildTenantMetadata } from '@order/infrastructure/grpc/build-tenant-metadata';
import { INVENTORY_GRPC_CLIENT } from '@order/infrastructure/grpc/grpc-clients.module';
import { retryOnAborted } from '@order/infrastructure/grpc/retry-on-aborted';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

const CALL_TIMEOUT_MS = 5000;

interface InventoryGrpcClientWithMetadata {
  reserve(request: ReserveRequest, metadata?: Metadata): Observable<ReserveResponse>;
  release(request: ReleaseRequest, metadata?: Metadata): Observable<ReleaseResponse>;
}

@Injectable()
export class InventoryGrpcAdapter implements InventoryGatewayPort, OnModuleInit {
  private readonly logger = new Logger(InventoryGrpcAdapter.name);
  private client!: InventoryGrpcClientWithMetadata;

  constructor(@Inject(INVENTORY_GRPC_CLIENT) private readonly grpc: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpc.getService<InventoryGrpcClientWithMetadata>(INVENTORY_SERVICE_NAME);
  }

  async reserve(
    tenantId: string,
    orderId: string,
    items: ReserveItemCommand[],
  ): Promise<ReserveOutcome> {
    const metadata = buildTenantMetadata(tenantId);
    try {
      const response = await retryOnAborted(() =>
        firstValueFrom(
          this.client
            .reserve({ tenantId, orderId, items }, metadata)
            .pipe(timeout(CALL_TIMEOUT_MS)),
        ),
      );
      return { ok: response.ok, reservationIds: response.reservationIds ?? [] };
    } catch (error) {
      throw this.mapError(error, 'reserve');
    }
  }

  async release(tenantId: string, orderId: string): Promise<ReleaseOutcome> {
    const metadata = buildTenantMetadata(tenantId);
    try {
      const response = await retryOnAborted(() =>
        firstValueFrom(
          this.client.release({ tenantId, orderId }, metadata).pipe(timeout(CALL_TIMEOUT_MS)),
        ),
      );
      return { ok: response.ok };
    } catch (error) {
      throw this.mapError(error, 'release');
    }
  }

  private mapError(error: unknown, op: 'reserve' | 'release'): Error {
    const code = (error as { code?: number; details?: string } | undefined)?.code;
    if (code === GrpcStatus.ALREADY_EXISTS) {
      return new IdempotencyConflictError(`inventory ${op} reports mismatched replay contents`);
    }
    if (code === GrpcStatus.ABORTED) {
      return new OrderConcurrencyConflictError(`inventory ${op} contention exhausted retries`);
    }
    this.logger.error(
      `inventory ${op} failed`,
      error instanceof Error ? error.stack : String(error),
    );
    return error instanceof Error ? error : new Error(`inventory ${op} failed`);
  }
}
