import {
  CATALOG_SERVICE_NAME,
  type GetMenuItemsRequest,
  type MenuItemsResponse,
} from '@food-delivery-api/shared-contracts';
import type { Metadata } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import type {
  CatalogGatewayPort,
  MenuItemSnapshot,
} from '@order/domain/shared/catalog-gateway.port';
import { buildTenantMetadata } from '@order/infrastructure/grpc/build-tenant-metadata';
import { CATALOG_GRPC_CLIENT } from '@order/infrastructure/grpc/grpc-clients.module';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

const CALL_TIMEOUT_MS = 5000;

/**
 * The hand-written `CatalogGrpcClient` contract (shared-contracts) omits the
 * metadata parameter for brevity; the actual Nest gRPC client proxy accepts
 * it as an optional second argument. Declared locally so this adapter's
 * outbound tenant metadata is honestly typed without widening the shared type.
 */
interface CatalogGrpcClientWithMetadata {
  getMenuItems(request: GetMenuItemsRequest, metadata?: Metadata): Observable<MenuItemsResponse>;
}

/**
 * Binds `CatalogGatewayPort` to a real gRPC call against the catalog
 * service. The tenant travels in metadata (never the request body) — the
 * same trust boundary catalog's gRPC edge enforces on the way in.
 */
@Injectable()
export class CatalogGrpcAdapter implements CatalogGatewayPort, OnModuleInit {
  private client!: CatalogGrpcClientWithMetadata;

  constructor(@Inject(CATALOG_GRPC_CLIENT) private readonly grpc: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpc.getService<CatalogGrpcClientWithMetadata>(CATALOG_SERVICE_NAME);
  }

  async validateItems(tenantId: string, itemIds: string[]): Promise<MenuItemSnapshot[]> {
    if (itemIds.length === 0) {
      return [];
    }
    const response = await firstValueFrom(
      this.client
        .getMenuItems({ tenantId, ids: itemIds }, buildTenantMetadata(tenantId))
        .pipe(timeout(CALL_TIMEOUT_MS)),
    );
    return (response.items ?? []).map((item) => ({
      itemId: item.id,
      restaurantId: item.restaurantId,
      priceCents: item.priceCents,
      isAvailable: item.isAvailable,
    }));
  }
}
