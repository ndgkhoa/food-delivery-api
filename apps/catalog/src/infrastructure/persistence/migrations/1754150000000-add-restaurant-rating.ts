import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantRating1754150000000 implements MigrationInterface {
  name = 'AddRestaurantRating1754150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "read_restaurants"
        ADD COLUMN "rating" real NOT NULL DEFAULT 0,
        ADD COLUMN "review_count" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "read_restaurants"
        DROP COLUMN "review_count",
        DROP COLUMN "rating"
    `);
  }
}
