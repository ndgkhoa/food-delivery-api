import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the polling outbox + saga state + dedupe ledger that make the order flow
 * an asynchronous, event-driven saga.
 *
 * `order_outbox` is drained by an in-app relay (`FOR UPDATE SKIP LOCKED`) that
 * publishes each row to Kafka and stamps `published_at`; a partial index on
 * unpublished rows keeps that hot path cheap. `id` is the event id (dedupe key),
 * `aggregate_id` the Kafka key (per-order ordering), `tenant_id`/`correlation_id`
 * ride as headers.
 *
 * `order_saga` holds one row per order; `version` backs the optimistic-lock
 * transition so two concurrently delivered replies can't both advance it.
 *
 * `processed_events` is the reply consumers' dedupe ledger, written in the same
 * transaction as the saga transition so "processed" and "applied" commit together.
 */
export class CreateOrderSagaAndOutbox1753747500000 implements MigrationInterface {
  name = 'CreateOrderSagaAndOutbox1753747500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "order_outbox" (
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
      'CREATE INDEX "idx_order_outbox_unpublished" ON "order_outbox" ("created_at") WHERE "published_at" IS NULL',
    );

    await queryRunner.query(`
      CREATE TABLE "order_saga" (
        "order_id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "state" varchar(20) NOT NULL,
        "correlation_id" uuid,
        "last_event_id" uuid,
        "version" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "processed_events" (
        "event_id" uuid PRIMARY KEY,
        "processed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "processed_events"');
    await queryRunner.query('DROP TABLE IF EXISTS "order_saga"');
    await queryRunner.query('DROP TABLE IF EXISTS "order_outbox"');
  }
}
