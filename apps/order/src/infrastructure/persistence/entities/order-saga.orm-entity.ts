import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Per-order saga state. Keyed by `order_id` (one saga per order). `version`
 * backs the optimistic-lock conditional update in the saga repository so two
 * concurrently delivered replies can't both advance the state. `last_event_id`
 * records the reply that last drove a transition (idempotency aid alongside the
 * `processed_events` ledger). The `(state, updated_at)` index backs the
 * stranded-saga reaper sweep.
 */
@Entity('order_saga')
@Index('idx_order_saga_state_updated_at', ['state', 'updatedAt'])
export class OrderSagaOrmEntity {
  @PrimaryColumn({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 20 })
  state!: string;

  @Column({ name: 'correlation_id', type: 'uuid', nullable: true })
  correlationId!: string | null;

  @Column({ name: 'last_event_id', type: 'uuid', nullable: true })
  lastEventId!: string | null;

  @Column({ type: 'integer', default: 0 })
  version!: number;

  /** Reconciler re-drive count — the reaper escalates instead of re-driving once this hits its cap. */
  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
