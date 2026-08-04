import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderTables1753747400000 implements MigrationInterface {
  name = 'CreateOrderTables1753747400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "status" varchar(20) NOT NULL,
        "total_cents" integer NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_orders_total_cents_non_negative" CHECK ("total_cents" >= 0)
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_orders_tenant_id" ON "orders" ("tenant_id")');
    await queryRunner.query(
      'CREATE INDEX "idx_orders_tenant_user" ON "orders" ("tenant_id", "user_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL REFERENCES "orders" ("id") ON DELETE CASCADE,
        "item_id" uuid NOT NULL,
        "qty" integer NOT NULL,
        "unit_price_cents" integer NOT NULL,
        "line_total_cents" integer NOT NULL,
        CONSTRAINT "chk_order_items_qty_positive" CHECK ("qty" > 0),
        CONSTRAINT "chk_order_items_unit_price_non_negative" CHECK ("unit_price_cents" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_order_items_order_id" ON "order_items" ("order_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "tenant_id" uuid NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "key" varchar(255) NOT NULL,
        "order_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_idempotency_keys" PRIMARY KEY ("tenant_id", "user_id", "key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "idempotency_keys"');
    await queryRunner.query('DROP TABLE IF EXISTS "order_items"');
    await queryRunner.query('DROP TABLE IF EXISTS "orders"');
  }
}
