import type { MigrationInterface, QueryRunner } from 'typeorm';

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
