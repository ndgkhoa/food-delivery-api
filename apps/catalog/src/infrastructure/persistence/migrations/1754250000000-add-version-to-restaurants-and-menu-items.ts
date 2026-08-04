import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVersionToRestaurantsAndMenuItems1754250000000 implements MigrationInterface {
  name = 'AddVersionToRestaurantsAndMenuItems1754250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "restaurants" ADD COLUMN "version" integer NOT NULL DEFAULT 1',
    );
    await queryRunner.query(
      'ALTER TABLE "menu_items" ADD COLUMN "version" integer NOT NULL DEFAULT 1',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "menu_items" DROP COLUMN "version"');
    await queryRunner.query('ALTER TABLE "restaurants" DROP COLUMN "version"');
  }
}
