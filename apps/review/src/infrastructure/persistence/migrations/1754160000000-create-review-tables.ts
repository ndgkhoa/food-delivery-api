import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewTables1754160000000 implements MigrationInterface {
  name = 'CreateReviewTables1754160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "review_eligible_orders" (
        "order_id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "restaurant_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "reviews" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL UNIQUE,
        "restaurant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "rating" smallint NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
        "comment" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_reviews_restaurant_tenant" ON "reviews" ("restaurant_id", "tenant_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "review_outbox" (
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
      'CREATE INDEX "idx_review_outbox_unpublished" ON "review_outbox" ("created_at") WHERE "published_at" IS NULL',
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
    await queryRunner.query('DROP TABLE IF EXISTS "review_outbox"');
    await queryRunner.query('DROP TABLE IF EXISTS "reviews"');
    await queryRunner.query('DROP TABLE IF EXISTS "review_eligible_orders"');
  }
}
