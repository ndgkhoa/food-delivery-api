import type { MigrationInterface, QueryRunner } from 'typeorm';

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
