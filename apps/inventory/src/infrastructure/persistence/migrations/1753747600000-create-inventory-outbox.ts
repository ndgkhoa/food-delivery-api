import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds inventory's polling outbox + dedupe ledger so it can reply to saga
 * commands over Kafka reliably.
 *
 * `inventory_outbox` is drained by an in-app relay (`FOR UPDATE SKIP LOCKED`)
 * that publishes each reply and stamps `published_at`; a partial index on
 * unpublished rows keeps that hot path cheap. `id` is the event id, `aggregate_id`
 * (order id) the Kafka key, `tenant_id`/`correlation_id` ride as headers.
 *
 * `processed_events` dedupes consumed command event ids, written in the same
 * transaction as the reply append so a re-delivered command replies at most once.
 */
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
