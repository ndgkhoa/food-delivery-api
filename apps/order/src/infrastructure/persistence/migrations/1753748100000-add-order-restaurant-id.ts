import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRestaurantId1753748100000 implements MigrationInterface {
  name = 'AddOrderRestaurantId1753748100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "orders" ADD COLUMN "restaurant_id" uuid');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "orders" DROP COLUMN "restaurant_id"');
  }
}
