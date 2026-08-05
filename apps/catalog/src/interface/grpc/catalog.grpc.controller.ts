import { GetMenuItemsByIdsHandler } from '@catalog/application/menu-item/queries/get-menu-items-by-ids.handler';
import { GrpcTenantContextInterceptor } from '@catalog/interface/grpc/grpc-tenant-context.interceptor';
import { MenuItemGrpcMapper } from '@catalog/interface/grpc/mappers/menu-item-grpc.mapper';
import {
  CATALOG_SERVICE_NAME,
  type CatalogGrpcService,
  type GetMenuItemsRequest,
  type MenuItemsResponse,
} from '@food-delivery-api/shared-contracts';
import { Controller, UseInterceptors } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';

@Controller()
@UseInterceptors(GrpcTenantContextInterceptor)
export class CatalogGrpcController implements CatalogGrpcService {
  constructor(private readonly getMenuItemsByIds: GetMenuItemsByIdsHandler) {}

  @GrpcMethod(CATALOG_SERVICE_NAME, 'GetMenuItems')
  async getMenuItems(request: GetMenuItemsRequest): Promise<MenuItemsResponse> {
    const items = await this.getMenuItemsByIds.execute(request.ids ?? []);
    return { items: items.map(MenuItemGrpcMapper.toMessage) };
  }
}
