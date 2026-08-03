import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the restaurant an order was placed for. NULLABLE — existing rows
 * predate the single-restaurant invariant (`PlaceOrderHandler` now asserts
 * every item shares one restaurant before an order can be created) and
 * cannot be backfilled from any other source, so they simply stay NULL. That
 * is correct, not a data gap: those orders are not reviewable since review
 * eligibility only starts from an `OrderConfirmed` event carrying a
 * restaurant, which is only emitted for orders created after this migration.
 */
export class AddOrderRestaurantId1753748100000 implements MigrationInterface {
  name = 'AddOrderRestaurantId1753748100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "orders" ADD COLUMN "restaurant_id" uuid');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "orders" DROP COLUMN "restaurant_id"');
  }
}
