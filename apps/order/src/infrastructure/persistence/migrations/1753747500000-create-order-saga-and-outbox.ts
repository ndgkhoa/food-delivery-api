import type { MigrationInterface, QueryRunner } from 'typeorm';

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
