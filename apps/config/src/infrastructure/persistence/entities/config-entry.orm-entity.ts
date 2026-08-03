import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('config_entries')
@Index(['key'])
export class ConfigEntryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  key!: string;

  // Postgres bigint maps to a JS string in TypeORM (avoids precision loss); the
  // mapper converts to/from the domain's numeric value.
  @Column({ type: 'bigint' })
  value!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
