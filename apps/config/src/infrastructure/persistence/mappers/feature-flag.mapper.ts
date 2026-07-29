import { FeatureFlag } from '@config/domain/config/feature-flag';
import { FeatureFlagOrmEntity } from '@config/infrastructure/persistence/entities/feature-flag.orm-entity';

export class FeatureFlagMapper {
  static toDomain(orm: FeatureFlagOrmEntity): FeatureFlag {
    return FeatureFlag.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      key: orm.key,
      enabled: orm.enabled,
      updatedAt: orm.updatedAt,
    });
  }

  static toOrm(domain: FeatureFlag): FeatureFlagOrmEntity {
    const orm = new FeatureFlagOrmEntity();
    orm.id = domain.id;
    orm.tenantId = domain.tenantId;
    orm.key = domain.key;
    orm.enabled = domain.enabled;
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}
