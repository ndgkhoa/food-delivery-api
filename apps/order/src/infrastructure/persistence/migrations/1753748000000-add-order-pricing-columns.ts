import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderPricingColumns1753748000000 implements MigrationInterface {
  name = 'AddOrderPricingColumns1753748000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "subtotal_cents" integer NOT NULL DEFAULT 0,
        ADD COLUMN "delivery_fee_cents" integer NOT NULL DEFAULT 0,
        ADD COLUMN "vat_cents" integer NOT NULL DEFAULT 0,
        ADD COLUMN "discount_cents" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query('UPDATE "orders" SET "subtotal_cents" = "total_cents"');

    await queryRunner.query(`
      ALTER TABLE "orders"
        ALTER COLUMN "subtotal_cents" DROP DEFAULT,
        ALTER COLUMN "delivery_fee_cents" DROP DEFAULT,
        ALTER COLUMN "vat_cents" DROP DEFAULT,
        ALTER COLUMN "discount_cents" DROP DEFAULT
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "chk_orders_subtotal_cents_non_negative" CHECK ("subtotal_cents" >= 0),
        ADD CONSTRAINT "chk_orders_delivery_fee_cents_non_negative" CHECK ("delivery_fee_cents" >= 0),
        ADD CONSTRAINT "chk_orders_vat_cents_non_negative" CHECK ("vat_cents" >= 0),
        ADD CONSTRAINT "chk_orders_discount_cents_non_negative" CHECK ("discount_cents" >= 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN "subtotal_cents",
        DROP COLUMN "delivery_fee_cents",
        DROP COLUMN "vat_cents",
        DROP COLUMN "discount_cents"
    `);
  }
}
