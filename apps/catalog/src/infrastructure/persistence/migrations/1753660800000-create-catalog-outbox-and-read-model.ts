import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogOutboxAndReadModel1753660800000 implements MigrationInterface {
  name = 'CreateCatalogOutboxAndReadModel1753660800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "aggregatetype" varchar(100) NOT NULL,
        "aggregateid" uuid NOT NULL,
        "type" varchar(100) NOT NULL,
        "payload" jsonb NOT NULL,
        "tenant_id" uuid NOT NULL,
        "correlationid" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "processed_events" (
        "event_id" uuid PRIMARY KEY,
        "processed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "read_restaurants" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_read_restaurants_tenant_id" ON "read_restaurants" ("tenant_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "read_menu_items" (
        "id" uuid PRIMARY KEY,
        "restaurant_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text,
        "price_cents" integer NOT NULL,
        "is_available" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_read_menu_items_tenant_id" ON "read_menu_items" ("tenant_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_read_menu_items_restaurant_id" ON "read_menu_items" ("restaurant_id")',
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'debezium') THEN
          CREATE ROLE "debezium" WITH LOGIN REPLICATION PASSWORD 'debezium';
        END IF;
      END
      $$;
    `);
    await queryRunner.query('GRANT USAGE ON SCHEMA public TO "debezium"');
    await queryRunner.query('GRANT SELECT ON "outbox" TO "debezium"');

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'dbz_catalog_outbox') THEN
          CREATE PUBLICATION "dbz_catalog_outbox" FOR TABLE "outbox";
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP PUBLICATION IF EXISTS "dbz_catalog_outbox"');
    await queryRunner.query('DROP TABLE IF EXISTS "read_menu_items"');
    await queryRunner.query('DROP TABLE IF EXISTS "read_restaurants"');
    await queryRunner.query('DROP TABLE IF EXISTS "processed_events"');
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'debezium') THEN
          EXECUTE 'DROP OWNED BY "debezium"';
        END IF;
      END
      $$;
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "outbox"');
    await queryRunner.query('DROP ROLE IF EXISTS "debezium"');
  }
}
