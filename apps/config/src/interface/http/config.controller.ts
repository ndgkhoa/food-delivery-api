import { GetConfigValueHandler } from '@config/application/config/get-config-value.handler';
import { GetFeatureFlagHandler } from '@config/application/config/get-feature-flag.handler';
import { ListConfigValuesHandler } from '@config/application/config/list-config-values.handler';
import { UpsertConfigValueHandler } from '@config/application/config/upsert-config-value.handler';
import { UpsertFeatureFlagHandler } from '@config/application/config/upsert-feature-flag.handler';
import { CONFIG_WRITE_ROLES } from '@config/domain/config/config-roles';
import type {
  ConfigValueListItemResponse,
  ConfigValueResponse,
} from '@config/interface/http/dto/config-value.response';
import type { FeatureFlagResponse } from '@config/interface/http/dto/feature-flag.response';
import { UpsertConfigValueRequest } from '@config/interface/http/dto/upsert-config-value.request';
import { UpsertFeatureFlagRequest } from '@config/interface/http/dto/upsert-feature-flag.request';
import { Roles } from '@food-delivery-api/shared-tenancy';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';

/**
 * Tunable business config (`config_entries`) + boolean feature flags
 * (`feature_flags`) — two separate concerns, never conflated. Reads resolve
 * tenant override ?? global default for the caller's tenant; writes require
 * `admin` (own-tenant override) or `platform-admin` (global default) — see
 * `config-roles.ts`. `flags/:key` routes are 2-segment paths so they never
 * collide with the 1-segment `:key` value routes below them.
 */
@Controller('config')
export class ConfigController {
  constructor(
    private readonly getValue: GetConfigValueHandler,
    private readonly listValues: ListConfigValuesHandler,
    private readonly upsertValue: UpsertConfigValueHandler,
    private readonly getFlag: GetFeatureFlagHandler,
    private readonly upsertFlag: UpsertFeatureFlagHandler,
  ) {}

  @Get()
  findAll(): Promise<ConfigValueListItemResponse[]> {
    return this.listValues.execute();
  }

  @Get('flags/:key')
  async findFlag(@Param('key') key: string): Promise<FeatureFlagResponse> {
    const enabled = await this.getFlag.execute(key);
    return { key, enabled };
  }

  @Put('flags/:key')
  @Roles(...CONFIG_WRITE_ROLES)
  async upsertFlagByKey(
    @Param('key') key: string,
    @Body() dto: UpsertFeatureFlagRequest,
  ): Promise<FeatureFlagResponse> {
    const enabled = await this.upsertFlag.execute({
      key,
      enabled: dto.enabled,
      global: dto.global ?? false,
    });
    return { key, enabled };
  }

  @Get(':key')
  async findOne(@Param('key') key: string): Promise<ConfigValueResponse> {
    const value = await this.getValue.execute(key);
    return { key, value };
  }

  @Put(':key')
  @Roles(...CONFIG_WRITE_ROLES)
  async upsertOne(
    @Param('key') key: string,
    @Body() dto: UpsertConfigValueRequest,
  ): Promise<ConfigValueResponse> {
    const value = await this.upsertValue.execute({
      key,
      value: dto.value,
      global: dto.global ?? false,
    });
    return { key, value };
  }
}
