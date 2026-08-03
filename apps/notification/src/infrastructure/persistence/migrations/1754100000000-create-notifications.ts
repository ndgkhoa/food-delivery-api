import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the notification service's own tables: `notifications` (one row per
 * event+channel, advanced PENDING -> SENT | FAILED | DEAD by the per-channel
 * BullMQ worker) and `processed_events` (dedupes the `order.events` consumer
 * by event id, written in the same transaction as the row batch).
 */
export class CreateNotifications1754100000000 implements MigrationInterface {
  name = 'CreateNotifications1754100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "channel" varchar(20) NOT NULL,
        "recipient" varchar(255) NOT NULL,
        "type" varchar(50) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_notifications_status" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'DEAD')),
        CONSTRAINT "uq_notifications_event_channel" UNIQUE ("event_id", "channel")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_notifications_tenant_id" ON "notifications" ("tenant_id")',
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
    await queryRunner.query('DROP TABLE IF EXISTS "notifications"');
  }
}
