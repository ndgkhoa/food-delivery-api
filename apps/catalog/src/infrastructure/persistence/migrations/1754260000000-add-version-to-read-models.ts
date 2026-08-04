import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVersionToReadModels1754260000000 implements MigrationInterface {
  name = 'AddVersionToReadModels1754260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "read_restaurants" ADD COLUMN "version" integer NOT NULL DEFAULT 1',
    );
    await queryRunner.query(
      'ALTER TABLE "read_menu_items" ADD COLUMN "version" integer NOT NULL DEFAULT 1',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "read_menu_items" DROP COLUMN "version"');
    await queryRunner.query('ALTER TABLE "read_restaurants" DROP COLUMN "version"');
  }
}
