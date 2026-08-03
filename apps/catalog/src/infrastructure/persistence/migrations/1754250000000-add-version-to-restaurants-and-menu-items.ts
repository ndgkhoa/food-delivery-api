import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a version column to `restaurants` and `menu_items` backing
 * optimistic-lock updates (mirrors `orders.version` — see `OrderOrmEntity`).
 * `DEFAULT 1` backfills existing rows to the same start value a freshly
 * inserted row gets, so a pre-existing row's first guarded update begins
 * from a consistent baseline. Metadata-only change, safe on a populated table.
 */
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
