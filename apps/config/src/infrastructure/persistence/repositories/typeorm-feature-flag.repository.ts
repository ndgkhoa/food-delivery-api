import type { FeatureFlag } from '@config/domain/config/feature-flag';
import type { FeatureFlagRepository } from '@config/domain/config/feature-flag.repository';
import { FeatureFlagOrmEntity } from '@config/infrastructure/persistence/entities/feature-flag.orm-entity';
import { FeatureFlagMapper } from '@config/infrastructure/persistence/mappers/feature-flag.mapper';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

@Injectable()
export class TypeOrmFeatureFlagRepository implements FeatureFlagRepository {
  constructor(
    @InjectRepository(FeatureFlagOrmEntity)
    private readonly repository: Repository<FeatureFlagOrmEntity>,
  ) {}

  async findTenantFlag(tenantId: string, key: string): Promise<FeatureFlag | null> {
    const orm = await this.repository.findOne({ where: { tenantId, key } });
    return orm ? FeatureFlagMapper.toDomain(orm) : null;
  }

  async findGlobalFlag(key: string): Promise<FeatureFlag | null> {
    const orm = await this.repository.findOne({ where: { tenantId: IsNull(), key } });
    return orm ? FeatureFlagMapper.toDomain(orm) : null;
  }

  // See TypeOrmConfigEntryRepository.upsert — identical create-or-update-by-id rationale.
  async upsert(flag: FeatureFlag): Promise<FeatureFlag> {
    const saved = await this.repository.save(FeatureFlagMapper.toOrm(flag));
    return FeatureFlagMapper.toDomain(saved);
  }
}
