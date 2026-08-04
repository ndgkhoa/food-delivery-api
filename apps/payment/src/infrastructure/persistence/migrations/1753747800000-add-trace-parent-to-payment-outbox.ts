import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTraceParentToPaymentOutbox1753747800000 implements MigrationInterface {
  name = 'AddTraceParentToPaymentOutbox1753747800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "payment_outbox" ADD COLUMN "trace_parent" varchar(64) NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "payment_outbox" DROP COLUMN "trace_parent"');
  }
}
