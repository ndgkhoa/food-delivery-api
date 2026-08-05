import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('stock')
@Index(['tenantId'])
export class StockOrmEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ type: 'integer' })
  available!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
