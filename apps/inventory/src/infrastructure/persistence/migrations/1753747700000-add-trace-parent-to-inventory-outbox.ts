import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTraceParentToInventoryOutbox1753747700000 implements MigrationInterface {
  name = 'AddTraceParentToInventoryOutbox1753747700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "inventory_outbox" ADD COLUMN "trace_parent" varchar(64) NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "inventory_outbox" DROP COLUMN "trace_parent"');
  }
}
