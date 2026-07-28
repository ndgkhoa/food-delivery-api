import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the payment stub's polling outbox + dedupe ledger. The stub owns no
 * domain tables yet (real payments/attempts arrive with the Temporal workflow
 * later) — here it only needs to reply to charge commands reliably.
 *
 * `payment_outbox` is drained by an in-app relay (`FOR UPDATE SKIP LOCKED`) that
 * publishes each reply and stamps `published_at`. `processed_events` dedupes
 * consumed command event ids, written in the same transaction as the reply.
 */
export class CreatePaymentOutbox1753747700000 implements MigrationInterface {
  name = 'CreatePaymentOutbox1753747700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE "payment_outbox" (
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
      'CREATE INDEX "idx_payment_outbox_unpublished" ON "payment_outbox" ("created_at") WHERE "published_at" IS NULL',
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
    await queryRunner.query('DROP TABLE IF EXISTS "payment_outbox"');
  }
}
