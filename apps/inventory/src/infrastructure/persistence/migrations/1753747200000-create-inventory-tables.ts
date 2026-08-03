import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the inventory schema: stock, reservations.
 *
 * `stock` is keyed by (tenant_id, item_id) and carries a CHECK (available >= 0)
 * — a storage-layer backstop so the no-oversell invariant holds even if a bug
 * bypassed the domain. `reservations` records each per-item hold for an order.
 */
export class CreateInventoryTables1753747200000 implements MigrationInterface {
  name = 'CreateInventoryTables1753747200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE "stock" (
        "tenant_id" uuid NOT NULL,
        "item_id" uuid NOT NULL,
        "available" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_stock" PRIMARY KEY ("tenant_id", "item_id"),
        CONSTRAINT "chk_stock_available_non_negative" CHECK ("available" >= 0)
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_stock_tenant_id" ON "stock" ("tenant_id")');

    await queryRunner.query(`
      CREATE TABLE "reservations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "item_id" uuid NOT NULL,
        "qty" integer NOT NULL,
        "status" varchar(20) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_reservations_tenant_id" ON "reservations" ("tenant_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_reservations_tenant_order" ON "reservations" ("tenant_id", "order_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "reservations"');
    await queryRunner.query('DROP TABLE IF EXISTS "stock"');
  }
}
