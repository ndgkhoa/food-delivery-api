import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-saga reconcile-attempt counter to `order_saga`. The stranded-saga
 * reconciler increments this every time it re-drives a stuck saga by
 * re-emitting the command its current state is waiting on; once the count
 * reaches the configured cap the saga is escalated instead of re-driven
 * again, bounding the retry loop. Defaults to 0 so every existing row starts
 * with a full budget.
 */
export class AddAttemptsToOrderSaga1753748500000 implements MigrationInterface {
  name = 'AddAttemptsToOrderSaga1753748500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "order_saga" ADD COLUMN "attempts" integer NOT NULL DEFAULT 0',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "order_saga" DROP COLUMN "attempts"');
  }
}
