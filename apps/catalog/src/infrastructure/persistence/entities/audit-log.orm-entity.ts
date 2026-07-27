import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AuditAction } from '../../../domain/shared/audit-action';

/**
 * Append-only ledger of every write in catalog. No update/delete repository
 * methods are exposed anywhere in this app for this entity — rows are
 * immutable once written.
 */
@Entity('audit_log')
@Index(['tenantId'])
@Index(['entity', 'entityId'])
export class AuditLogOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255 })
  actor!: string;

  @Column({ type: 'varchar', length: 20 })
  action!: AuditAction;

  @Column({ type: 'varchar', length: 100 })
  entity!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
