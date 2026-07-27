import { Tenant } from '@auth/domain/tenant/tenant';
import { TenantOrmEntity } from '@auth/infrastructure/persistence/entities/tenant.orm-entity';

export class TenantMapper {
  static toDomain(orm: TenantOrmEntity): Tenant {
    return Tenant.reconstitute({
      id: orm.id,
      name: orm.name,
      slug: orm.slug,
      isActive: orm.isActive,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  static toOrm(domain: Tenant): TenantOrmEntity {
    const orm = new TenantOrmEntity();
    orm.id = domain.id;
    orm.name = domain.name;
    orm.slug = domain.slug;
    orm.isActive = domain.isActive;
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}
