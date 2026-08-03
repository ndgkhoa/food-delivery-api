import { GetAssignmentQuery } from '@delivery/application/get-assignment.query';
import { NearbyDriversQuery } from '@delivery/application/nearby-drivers.query';
import type {
  AssignmentResponse,
  NearbyDriverResponse,
} from '@delivery/interface/http/dto/delivery.response';
import { NearbyDriversRequest } from '@delivery/interface/http/dto/nearby-drivers.request';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Read API for delivery tracking. Both routes are tenant-scoped: the tenant comes
 * from the trusted identity the gateway verified and propagated (never a raw
 * client header), so a caller only ever sees its own tenant's drivers and
 * assignments. Live driver movement is delivered over WebSocket, not here.
 */
@Controller('delivery/orders')
export class DeliveryController {
  private readonly defaultRadiusMeters: number;

  constructor(
    private readonly nearbyDrivers: NearbyDriversQuery,
    private readonly getAssignment: GetAssignmentQuery,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    config: ConfigService,
  ) {
    this.defaultRadiusMeters = config.getOrThrow<number>('NEARBY_RADIUS_M');
  }

  @Get(':orderId/nearby-drivers')
  async nearby(
    @Param('orderId', ParseUUIDPipe) _orderId: string,
    @Query() dto: NearbyDriversRequest,
  ): Promise<NearbyDriverResponse[]> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.nearbyDrivers.execute(tenantId, {
      lat: dto.lat,
      lng: dto.lng,
      radiusMeters: dto.radius ?? this.defaultRadiusMeters,
    });
  }

  @Get(':orderId/assignment')
  async assignment(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<AssignmentResponse> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const assignment = await this.getAssignment.execute(tenantId, orderId);
    return {
      orderId,
      assigned: assignment !== undefined,
      driverId: assignment?.driverId ?? null,
    };
  }
}
