import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the media schema: `media_objects`, the metadata row for every uploaded
 * image. Carries tenant_id (multi-tenant row filtering) + created_at/updated_at.
 * The object bytes themselves live in MinIO, keyed by object_key; thumbnail_key
 * is populated once the thumbnail worker completes.
 */
export class CreateMediaObjects1754006400000 implements MigrationInterface {
  name = 'CreateMediaObjects1754006400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE "media_objects" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "object_key" varchar(512) NOT NULL,
        "content_type" varchar(255) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "status" varchar(20) NOT NULL,
        "thumbnail_key" varchar(512),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_media_objects_tenant_id" ON "media_objects" ("tenant_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "media_objects"');
  }
}
