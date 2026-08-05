import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryOutbox1753747600000 implements MigrationInterface {
  name = 'CreateInventoryOutbox1753747600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory_outbox" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "aggregate_id" uuid NOT NULL,
        "topic" varchar(120) NOT NULL,
        "event_type" varchar(100) NOT NULL,
        "payload" jsonb NOT NULL,
        "tenant_id" uuid NOT NULL,
        "correlation_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_inventory_outbox_unpublished" ON "inventory_outbox" ("created_at") WHERE "published_at" IS NULL',
    );

    await queryRunner.query(`
      CREATE TABLE "processed_events" (
        "event_id" uuid PRIMARY KEY,
        "processed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "processed_events"');
    await queryRunner.query('DROP TABLE IF EXISTS "inventory_outbox"');
  }
}
