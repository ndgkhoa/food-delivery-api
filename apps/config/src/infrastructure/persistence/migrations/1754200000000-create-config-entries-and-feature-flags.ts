import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConfigEntriesAndFeatureFlags1754200000000 implements MigrationInterface {
  name = 'CreateConfigEntriesAndFeatureFlags1754200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE "config_entries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid,
        "key" varchar(255) NOT NULL,
        "value" bigint NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_config_entries_tenant_key" ON "config_entries" ("tenant_id", "key") WHERE "tenant_id" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_config_entries_global_key" ON "config_entries" ("key") WHERE "tenant_id" IS NULL',
    );
    await queryRunner.query('CREATE INDEX "idx_config_entries_key" ON "config_entries" ("key")');

    await queryRunner.query(`
      CREATE TABLE "feature_flags" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid,
        "key" varchar(255) NOT NULL,
        "enabled" boolean NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_feature_flags_tenant_key" ON "feature_flags" ("tenant_id", "key") WHERE "tenant_id" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_feature_flags_global_key" ON "feature_flags" ("key") WHERE "tenant_id" IS NULL',
    );
    await queryRunner.query('CREATE INDEX "idx_feature_flags_key" ON "feature_flags" ("key")');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "feature_flags"');
    await queryRunner.query('DROP TABLE IF EXISTS "config_entries"');
  }
}
