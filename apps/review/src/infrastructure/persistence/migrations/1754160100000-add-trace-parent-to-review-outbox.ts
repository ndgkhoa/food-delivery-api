import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTraceParentToReviewOutbox1754160100000 implements MigrationInterface {
  name = 'AddTraceParentToReviewOutbox1754160100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "review_outbox" ADD COLUMN "trace_parent" varchar(64) NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "review_outbox" DROP COLUMN "trace_parent"');
  }
}
