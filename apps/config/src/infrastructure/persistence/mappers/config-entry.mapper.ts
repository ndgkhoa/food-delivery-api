import { ConfigEntry } from '@config/domain/config/config-entry';
import { ConfigEntryOrmEntity } from '@config/infrastructure/persistence/entities/config-entry.orm-entity';

export class ConfigEntryMapper {
  static toDomain(orm: ConfigEntryOrmEntity): ConfigEntry {
    return ConfigEntry.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      key: orm.key,
      value: Number(orm.value),
      updatedAt: orm.updatedAt,
    });
  }

  static toOrm(domain: ConfigEntry): ConfigEntryOrmEntity {
    const orm = new ConfigEntryOrmEntity();
    orm.id = domain.id;
    orm.tenantId = domain.tenantId;
    orm.key = domain.key;
    orm.value = String(domain.value);
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}
