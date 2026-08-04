import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTraceParentToOrderOutbox1753748400000 implements MigrationInterface {
  name = 'AddTraceParentToOrderOutbox1753748400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "order_outbox" ADD COLUMN "trace_parent" varchar(64) NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "order_outbox" DROP COLUMN "trace_parent"');
  }
}
