import { resolveFeatureFlag } from '@config/domain/config/config-resolution';
import {
  FEATURE_FLAG_REPOSITORY,
  type FeatureFlagRepository,
} from '@config/domain/config/feature-flag.repository';
import { FeatureFlagNotFoundError } from '@config/domain/shared/errors';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetFeatureFlagHandler {
  constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly repository: FeatureFlagRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(key: string): Promise<boolean> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const [tenantFlag, globalFlag] = await Promise.all([
      this.repository.findTenantFlag(tenantId, key),
      this.repository.findGlobalFlag(key),
    ]);

    const enabled = resolveFeatureFlag(tenantFlag, globalFlag);
    if (enabled === undefined) {
      throw new FeatureFlagNotFoundError(key);
    }
    return enabled;
  }
}
