import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforces reserve idempotency at the storage layer: at most one ACTIVE
 * reservation per (tenant_id, order_id, item_id). If a concurrent duplicate
 * reserve slips past the in-transaction read-check (e.g. the Redis lock was
 * lost), this partial unique index rejects the second insert — so an order can
 * never double-reserve the same item. Partial (WHERE status = 'ACTIVE') so a
 * released reservation doesn't block re-reserving the item on a later order.
 */
export class AddActiveReservationUniqueIndex1753747300000 implements MigrationInterface {
  name = 'AddActiveReservationUniqueIndex1753747300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_reservations_active_order_item"
      ON "reservations" ("tenant_id", "order_id", "item_id")
      WHERE "status" = 'ACTIVE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "uq_reservations_active_order_item"');
  }
}
