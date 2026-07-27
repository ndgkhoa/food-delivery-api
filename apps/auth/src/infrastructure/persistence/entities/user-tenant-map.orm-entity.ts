import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Registry row linking a Keycloak user to the tenant it was provisioned under.
 * Append-only in practice (no updated_at / soft-delete) — a re-provision would
 * be a new user. `keycloak_user_id` is unique: one user maps to one tenant.
 */
@Entity('user_tenant_map')
export class UserTenantMapOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'keycloak_user_id', type: 'varchar', length: 255 })
  keycloakUserId!: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 50 })
  role!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
