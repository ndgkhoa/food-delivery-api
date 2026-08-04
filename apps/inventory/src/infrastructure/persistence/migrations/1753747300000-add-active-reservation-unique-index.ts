import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActiveReservationUniqueIndex1753747300000 implements MigrationInterface {
  name = 'AddActiveReservationUniqueIndex1753747300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_reservations_active_order_item"
      ON "reservations" ("tenant_id", "order_id", "item_id")
      WHERE "status" = 'ACTIVE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "uq_reservations_active_order_item"');
  }
}
