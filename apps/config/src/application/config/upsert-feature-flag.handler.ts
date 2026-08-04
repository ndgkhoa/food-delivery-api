import { randomUUID } from 'node:crypto';
import {
  CONFIG_EVENT_PUBLISHER,
  type ConfigEventPublisherPort,
} from '@config/domain/config/config-event';
import { CONFIG_PLATFORM_ADMIN_ROLE } from '@config/domain/config/config-roles';
import { FeatureFlag } from '@config/domain/config/feature-flag';
import {
  FEATURE_FLAG_REPOSITORY,
  type FeatureFlagRepository,
} from '@config/domain/config/feature-flag.repository';
import { GlobalWriteRequiresPlatformAdminError } from '@config/domain/shared/errors';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable, Logger } from '@nestjs/common';

export interface UpsertFeatureFlagCommand {
  key: string;
  enabled: boolean;
  global: boolean;
}

@Injectable()
export class UpsertFeatureFlagHandler {
  private readonly logger = new Logger(UpsertFeatureFlagHandler.name);

  constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly repository: FeatureFlagRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(CONFIG_EVENT_PUBLISHER) private readonly publisher: ConfigEventPublisherPort,
  ) {}

  async execute(command: UpsertFeatureFlagCommand): Promise<boolean> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const roles = this.tenantContext.getContext()?.roles ?? [];

    if (command.global && !roles.includes(CONFIG_PLATFORM_ADMIN_ROLE)) {
      throw new GlobalWriteRequiresPlatformAdminError();
    }
    const targetTenantId = command.global ? null : tenantId;

    const existing = targetTenantId
      ? await this.repository.findTenantFlag(targetTenantId, command.key)
      : await this.repository.findGlobalFlag(command.key);

    const flag = existing
      ? existing.withEnabled(command.enabled)
      : FeatureFlag.create({
          id: randomUUID(),
          tenantId: targetTenantId,
          key: command.key,
          enabled: command.enabled,
        });

    const saved = await this.repository.upsert(flag);

    await this.publisher
      .publishFlagChanged({ tenantId: saved.tenantId, key: saved.key })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to publish FeatureFlagChanged for "${saved.key}": ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    return saved.enabled;
  }
}
