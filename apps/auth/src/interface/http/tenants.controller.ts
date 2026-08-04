import { CreateTenantHandler } from '@auth/application/tenant/commands/create-tenant.handler';
import { ProvisionUserHandler } from '@auth/application/tenant/commands/provision-user.handler';
import { GetTenantHandler } from '@auth/application/tenant/queries/get-tenant.handler';
import { ListTenantsHandler } from '@auth/application/tenant/queries/list-tenants.handler';
import { CreateTenantRequest } from '@auth/interface/http/dto/create-tenant.request';
import type { PaginatedResponse } from '@auth/interface/http/dto/paginated.response';
import { PaginationRequest } from '@auth/interface/http/dto/pagination.request';
import { ProvisionUserRequest } from '@auth/interface/http/dto/provision-user.request';
import type { ProvisionedUserResponse } from '@auth/interface/http/dto/provisioned-user.response';
import type { TenantResponse } from '@auth/interface/http/dto/tenant.response';
import { ProvisionedUserResponseMapper } from '@auth/interface/http/mappers/provisioned-user-response.mapper';
import { TenantResponseMapper } from '@auth/interface/http/mappers/tenant-response.mapper';
import { Roles } from '@food-delivery-api/shared-tenancy';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

@Controller('tenants')
@Roles('admin')
export class TenantsController {
  constructor(
    private readonly createTenant: CreateTenantHandler,
    private readonly provisionUser: ProvisionUserHandler,
    private readonly listTenants: ListTenantsHandler,
    private readonly getTenant: GetTenantHandler,
  ) {}

  @Post()
  async create(@Body() dto: CreateTenantRequest): Promise<TenantResponse> {
    const tenant = await this.createTenant.execute(dto);
    return TenantResponseMapper.toResponse(tenant);
  }

  @Post(':id/users')
  async provision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProvisionUserRequest,
  ): Promise<ProvisionedUserResponse> {
    const link = await this.provisionUser.execute({ tenantId: id, ...dto });
    return ProvisionedUserResponseMapper.toResponse(link);
  }

  @Get()
  async findAll(
    @Query() pagination: PaginationRequest,
  ): Promise<PaginatedResponse<TenantResponse>> {
    const result = await this.listTenants.execute(pagination);
    return { ...result, data: result.data.map(TenantResponseMapper.toResponse) };
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TenantResponse> {
    const tenant = await this.getTenant.execute(id);
    return TenantResponseMapper.toResponse(tenant);
  }
}
