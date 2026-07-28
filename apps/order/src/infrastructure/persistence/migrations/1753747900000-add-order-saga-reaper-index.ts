import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Composite index backing the stranded-saga reaper sweep, which scans for sagas
 * stuck in a non-terminal state (`state IN (...) AND updated_at < threshold`).
 * Ordering the index by `(state, updated_at)` lets that scan seek straight to
 * the oldest rows of each non-terminal state instead of scanning the whole
 * table on every sweep.
 */
export class AddOrderSagaReaperIndex1753747900000 implements MigrationInterface {
  name = 'AddOrderSagaReaperIndex1753747900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX "idx_order_saga_state_updated_at" ON "order_saga" ("state", "updated_at")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_order_saga_state_updated_at"');
  }
}
