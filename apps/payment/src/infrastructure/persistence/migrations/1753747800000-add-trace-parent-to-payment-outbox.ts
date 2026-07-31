import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a nullable `trace_parent` column to `payment_outbox`, captured
 * synchronously (in-request, alongside the rest of the row) at `append` time
 * from whatever W3C trace context is active. The polling relay's later
 * publish tick forwards it as the Kafka `traceparent` header instead of
 * starting a fresh, disconnected trace at publish time — bridging the async
 * DB-persist -> relay-publish gap so the whole saga shares one trace id.
 * Nullable: existing rows and telemetry-off/test runs simply carry no
 * captured context, and the relay/producer fall back to their prior per-hop
 * behavior unchanged.
 */
export class AddTraceParentToPaymentOutbox1753747800000 implements MigrationInterface {
  name = 'AddTraceParentToPaymentOutbox1753747800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "payment_outbox" ADD COLUMN "trace_parent" varchar(64) NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "payment_outbox" DROP COLUMN "trace_parent"');
  }
}
