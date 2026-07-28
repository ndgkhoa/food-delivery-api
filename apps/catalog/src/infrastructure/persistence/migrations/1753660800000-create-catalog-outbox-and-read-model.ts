import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the CDC outbox + CQRS read model to catalog.
 *
 * `outbox` follows the Debezium Outbox Event Router column convention
 * (aggregatetype/aggregateid/type/payload) so the SMT can route rows to
 * `<aggregatetype>.events` with minimal config. Rows are insert-only: a write
 * handler appends one row in the same transaction as the domain change, and
 * Debezium tails the WAL to publish it — the app never publishes directly.
 *
 * `processed_events` is the projection consumer's dedupe ledger (one row per
 * consumed event id), written in the same transaction as the read-model upsert
 * so "processed" and "applied" commit or roll back together.
 *
 * `read_restaurants` / `read_menu_items` are the denormalized read model the
 * list/get endpoints serve from, kept eventually consistent by the projection.
 *
 * A least-privilege `debezium` role (REPLICATION + SELECT on outbox only) and a
 * publication scoped to the outbox table are provisioned here, guarded so a
 * re-run is safe. `wal_level=logical` is a server flag set in compose, not here.
 */
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

    // Least-privilege CDC role: can stream the WAL (REPLICATION) and read only
    // the outbox table — never the domain tables. Password is a local-dev
    // default; real deployments inject it via a secret provider.
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

    // Pre-create the publication scoped to outbox so Debezium (autocreate
    // mode "filtered") finds it instead of needing table-owner privileges at
    // runtime. Guarded because CREATE PUBLICATION has no IF NOT EXISTS.
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
    // Drop every privilege granted to the role (SELECT on outbox + USAGE on
    // schema) before the role itself — Postgres refuses DROP ROLE while any
    // grant still depends on it. DROP OWNED clears them in one shot.
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
