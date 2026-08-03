import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the aggregate rating columns the review service's recompute events
 * feed into the restaurant read model. `rating` is a float (2-decimal average,
 * rounded by the review service before it's published) defaulting to 0 for a
 * restaurant with no reviews yet; `review_count` tracks how many reviews
 * back it. Both are owned exclusively by the new `review.events` projector —
 * the existing `catalog.events` projector's upsert never touches them (see
 * `TypeOrmReadRestaurantRepository.upsert`'s explicit column list).
 */
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
