import { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';
import { UserTenantMapOrmEntity } from '@auth/infrastructure/persistence/entities/user-tenant-map.orm-entity';

export class UserTenantLinkMapper {
  static toDomain(orm: UserTenantMapOrmEntity): UserTenantLink {
    return UserTenantLink.reconstitute({
      id: orm.id,
      keycloakUserId: orm.keycloakUserId,
      tenantId: orm.tenantId,
      role: orm.role,
      createdAt: orm.createdAt,
    });
  }

  static toOrm(domain: UserTenantLink): UserTenantMapOrmEntity {
    const orm = new UserTenantMapOrmEntity();
    orm.id = domain.id;
    orm.keycloakUserId = domain.keycloakUserId;
    orm.tenantId = domain.tenantId;
    orm.role = domain.role;
    orm.createdAt = domain.createdAt;
    return orm;
  }
}
