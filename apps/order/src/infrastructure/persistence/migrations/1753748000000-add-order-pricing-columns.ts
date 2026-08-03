import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the delivery-fee/VAT/discount pricing breakdown to `orders`, sourced at
 * placement time from tenant-overridable config values. Existing rows only
 * ever had a lump total, so the backfill treats every historical
 * `total_cents` as pure subtotal (`delivery_fee_cents`/`vat_cents`/
 * `discount_cents` = 0) — the invariant `total_cents = subtotal_cents +
 * delivery_fee_cents + vat_cents - discount_cents` holds for every row both
 * before and after this migration.
 */
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

    // Backfill: a historical order's total WAS the subtotal (fee/VAT/discount
    // did not exist yet) — the other three columns keep their 0 default.
    await queryRunner.query('UPDATE "orders" SET "subtotal_cents" = "total_cents"');

    // Every insert going forward always supplies all four columns explicitly
    // (mirrors total_cents, which has never had a default) — drop the
    // backfill-only defaults so a future insert can't silently omit one.
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
