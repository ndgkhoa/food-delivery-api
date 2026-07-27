import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the catalog schema: restaurants, menu_items, audit_log.
 * Every table carries tenant_id (multi-tenant row filtering), created_at/
 * updated_at, and (except audit_log, which is append-only) a soft-delete
 * deleted_at column — see architecture.md §4 cross-cutting concerns.
 */
export class CreateCatalogTables1753574400000 implements MigrationInterface {
  name = 'CreateCatalogTables1753574400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE "restaurants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_restaurants_tenant_id" ON "restaurants" ("tenant_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "menu_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
        "name" varchar(255) NOT NULL,
        "description" text,
        "price_cents" integer NOT NULL,
        "is_available" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_menu_items_tenant_id" ON "menu_items" ("tenant_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_menu_items_restaurant_id" ON "menu_items" ("restaurant_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "actor" varchar(255) NOT NULL,
        "action" varchar(20) NOT NULL,
        "entity" varchar(100) NOT NULL,
        "entity_id" uuid NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_audit_log_tenant_id" ON "audit_log" ("tenant_id")');
    await queryRunner.query(
      'CREATE INDEX "idx_audit_log_entity" ON "audit_log" ("entity", "entity_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "audit_log"');
    await queryRunner.query('DROP TABLE IF EXISTS "menu_items"');
    await queryRunner.query('DROP TABLE IF EXISTS "restaurants"');
  }
}
