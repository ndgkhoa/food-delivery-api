import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Projects the write model's `version` (added by
 * `AddVersionToRestaurantsAndMenuItems1754250000000`) into the read model so a
 * client's `GET` reflects the same version the write aggregate enforces on
 * `PATCH`. Without this, `read_restaurants`/`read_menu_items` had no version
 * column at all — the domain getter's `?? 1` default silently stood in, so
 * every read returned a constant `version: 1` regardless of how many times the
 * aggregate had actually been updated, breaking `If-Match` conditional updates
 * on the real read-then-write client flow. `DEFAULT 1` backfills existing rows
 * to the same start value a freshly projected row gets; metadata-only change,
 * safe on a populated table.
 */
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
