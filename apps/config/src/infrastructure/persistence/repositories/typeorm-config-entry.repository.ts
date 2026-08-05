import type { ConfigEntry } from '@config/domain/config/config-entry';
import type { ConfigEntryRepository } from '@config/domain/config/config-entry.repository';
import { ConfigEntryOrmEntity } from '@config/infrastructure/persistence/entities/config-entry.orm-entity';
import { ConfigEntryMapper } from '@config/infrastructure/persistence/mappers/config-entry.mapper';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

@Injectable()
export class TypeOrmConfigEntryRepository implements ConfigEntryRepository {
  constructor(
    @InjectRepository(ConfigEntryOrmEntity)
    private readonly repository: Repository<ConfigEntryOrmEntity>,
  ) {}

  async findTenantEntry(tenantId: string, key: string): Promise<ConfigEntry | null> {
    const orm = await this.repository.findOne({ where: { tenantId, key } });
    return orm ? ConfigEntryMapper.toDomain(orm) : null;
  }

  async findGlobalEntry(key: string): Promise<ConfigEntry | null> {
    const orm = await this.repository.findOne({ where: { tenantId: IsNull(), key } });
    return orm ? ConfigEntryMapper.toDomain(orm) : null;
  }

  async findAllForTenant(tenantId: string): Promise<ConfigEntry[]> {
    const rows = await this.repository.find({
      where: [{ tenantId }, { tenantId: IsNull() }],
      order: { key: 'ASC' },
    });
    return rows.map(ConfigEntryMapper.toDomain);
  }

  async upsert(entry: ConfigEntry): Promise<ConfigEntry> {
    const saved = await this.repository.save(ConfigEntryMapper.toOrm(entry));
    return ConfigEntryMapper.toDomain(saved);
  }
}
