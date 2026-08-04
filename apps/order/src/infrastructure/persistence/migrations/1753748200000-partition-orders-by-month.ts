import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PartitionOrdersByMonth1753748200000 implements MigrationInterface {
  name = 'PartitionOrdersByMonth1753748200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "orders_partitioned" (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "restaurant_id" uuid,
        "status" varchar(20) NOT NULL,
        "subtotal_cents" integer NOT NULL,
        "delivery_fee_cents" integer NOT NULL,
        "vat_cents" integer NOT NULL,
        "discount_cents" integer NOT NULL,
        "total_cents" integer NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_orders_total_cents_non_negative" CHECK ("total_cents" >= 0),
        CONSTRAINT "chk_orders_subtotal_cents_non_negative" CHECK ("subtotal_cents" >= 0),
        CONSTRAINT "chk_orders_delivery_fee_cents_non_negative" CHECK ("delivery_fee_cents" >= 0),
        CONSTRAINT "chk_orders_vat_cents_non_negative" CHECK ("vat_cents" >= 0),
        CONSTRAINT "chk_orders_discount_cents_non_negative" CHECK ("discount_cents" >= 0),
        CONSTRAINT "pk_orders" PRIMARY KEY ("created_at", "id")
      ) PARTITION BY RANGE ("created_at")
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        start_month timestamptz;
        end_month_exclusive timestamptz;
        cur timestamptz;
        partition_name text;
      BEGIN
        SELECT date_trunc('month', COALESCE(MIN("created_at"), now())) INTO start_month FROM "orders";
        SELECT date_trunc('month', GREATEST(COALESCE(MAX("created_at"), now()), now())) + interval '2 months'
          INTO end_month_exclusive FROM "orders";

        cur := start_month;
        WHILE cur < end_month_exclusive LOOP
          partition_name := 'orders_p' || to_char(cur, 'YYYYMM');
          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF "orders_partitioned" FOR VALUES FROM (%L) TO (%L)',
            partition_name, cur, cur + interval '1 month'
          );
          cur := cur + interval '1 month';
        END LOOP;
      END $$;
    `);

    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS "orders_default" PARTITION OF "orders_partitioned" DEFAULT',
    );

    await queryRunner.query(`
      INSERT INTO "orders_partitioned"
        ("id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at")
      SELECT
        "id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at"
      FROM "orders"
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        orders_count bigint;
        partitioned_count bigint;
      BEGIN
        SELECT count(*) INTO orders_count FROM "orders";
        SELECT count(*) INTO partitioned_count FROM "orders_partitioned";
        IF orders_count <> partitioned_count THEN
          RAISE EXCEPTION 'orders row-count mismatch after partition copy: orders=%, orders_partitioned=%',
            orders_count, partitioned_count;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        fk_name text;
      BEGIN
        SELECT tc.constraint_name INTO fk_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = 'order_items'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'order_id';

        IF fk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "order_items" DROP CONSTRAINT %I', fk_name);
        END IF;
      END $$;
    `);

    await queryRunner.query('ALTER TABLE "orders" RENAME TO "orders_legacy"');
    await queryRunner.query('ALTER TABLE "orders_partitioned" RENAME TO "orders"');
    await queryRunner.query('DROP TABLE "orders_legacy"');

    await queryRunner.query('CREATE INDEX "idx_orders_tenant_id" ON "orders" ("tenant_id")');
    await queryRunner.query(
      'CREATE INDEX "idx_orders_tenant_user" ON "orders" ("tenant_id", "user_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "orders_unpartitioned" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "restaurant_id" uuid,
        "status" varchar(20) NOT NULL,
        "subtotal_cents" integer NOT NULL,
        "delivery_fee_cents" integer NOT NULL,
        "vat_cents" integer NOT NULL,
        "discount_cents" integer NOT NULL,
        "total_cents" integer NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_orders_total_cents_non_negative" CHECK ("total_cents" >= 0),
        CONSTRAINT "chk_orders_subtotal_cents_non_negative" CHECK ("subtotal_cents" >= 0),
        CONSTRAINT "chk_orders_delivery_fee_cents_non_negative" CHECK ("delivery_fee_cents" >= 0),
        CONSTRAINT "chk_orders_vat_cents_non_negative" CHECK ("vat_cents" >= 0),
        CONSTRAINT "chk_orders_discount_cents_non_negative" CHECK ("discount_cents" >= 0)
      )
    `);

    await queryRunner.query(`
      INSERT INTO "orders_unpartitioned"
        ("id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at")
      SELECT
        "id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at"
      FROM "orders"
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        partitioned_count bigint;
        restored_count bigint;
      BEGIN
        SELECT count(*) INTO partitioned_count FROM "orders";
        SELECT count(*) INTO restored_count FROM "orders_unpartitioned";
        IF partitioned_count <> restored_count THEN
          RAISE EXCEPTION 'orders row-count mismatch while reverting partitioning: orders=%, orders_unpartitioned=%',
            partitioned_count, restored_count;
        END IF;
      END $$;
    `);

    await queryRunner.query('ALTER TABLE "orders" RENAME TO "orders_partitioned_old"');
    await queryRunner.query('ALTER TABLE "orders_unpartitioned" RENAME TO "orders"');
    await queryRunner.query('DROP TABLE "orders_partitioned_old" CASCADE');

    await queryRunner.query('CREATE INDEX "idx_orders_tenant_id" ON "orders" ("tenant_id")');
    await queryRunner.query(
      'CREATE INDEX "idx_orders_tenant_user" ON "orders" ("tenant_id", "user_id")',
    );

    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD CONSTRAINT "order_items_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE
    `);
  }
}
