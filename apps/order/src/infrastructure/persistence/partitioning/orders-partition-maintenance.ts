import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export interface MonthPartitionRange {
  /** e.g. `orders_p202608`. */
  partitionName: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  fromDate: string;
  /** Exclusive upper bound, `YYYY-MM-DD` — the first day of the FOLLOWING month. */
  toDateExclusive: string;
}

/**
 * Pure: given a reference date and a month offset (0 = the reference month,
 * 1 = next month, …), returns the partition name and `[from, to)` bounds for
 * that calendar month in UTC — e.g. reference July 2026 + offset 1 yields
 * `orders_p202608` covering `[2026-08-01, 2026-09-01)`. All UTC so the bounds
 * are independent of the server/session timezone. Side-effect free so the
 * boundary math is unit-testable without a database.
 */
export function computeMonthPartitionRange(
  referenceDate: Date,
  monthOffset: number,
): MonthPartitionRange {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth(); // 0-based
  const start = new Date(Date.UTC(year, month + monthOffset, 1));
  const next = new Date(Date.UTC(year, month + monthOffset + 1, 1));

  return {
    partitionName: `orders_p${formatYyyyMm(start)}`,
    fromDate: formatIsoDate(start),
    toDateExclusive: formatIsoDate(next),
  };
}

function formatYyyyMm(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Pre-creates the CURRENT and NEXT month `orders` partitions so an order never
 * hits the DEFAULT partition. Ensuring the CURRENT month (not just next) on
 * every boot is what makes a missed cron tick — or a service that was down long
 * enough to skip a month — self-heal: whatever month the service starts in gets
 * its partition BEFORE it serves traffic, so rows never fall to DEFAULT (once
 * rows land in DEFAULT for a month, `CREATE PARTITION OF` for that range would
 * fail on overlap, stranding the month in DEFAULT with degraded pruning). Runs
 * on boot + a monthly cron; both are idempotent (`CREATE TABLE IF NOT EXISTS`).
 * Disabled under `NODE_ENV=test` — suites manage their own schema via the
 * migration.
 *
 * A month-long outage that spanned an order's placement into DEFAULT is the
 * only residual gap (needs a manual detach+recreate) — flagged, not auto-healed.
 * Retention (dropping partitions older than N months) is a follow-up once
 * volume warrants it.
 */
@Injectable()
export class OrdersPartitionMaintenanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrdersPartitionMaintenanceService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.isDisabled()) {
      this.logger.warn('Orders partition maintenance disabled (NODE_ENV=test)');
      return;
    }
    await this.ensureUpcomingPartitions();
  }

  /** 1st of every month, just after midnight — well ahead of the month it covers. */
  @Cron('0 0 1 * *')
  async monthlyMaintenance(): Promise<void> {
    if (this.isDisabled()) {
      return;
    }
    await this.ensureUpcomingPartitions();
  }

  /** Ensures the CURRENT and NEXT month partitions exist. Idempotent — safe on every boot + tick. */
  async ensureUpcomingPartitions(referenceDate: Date = new Date()): Promise<void> {
    for (const monthOffset of [0, 1]) {
      await this.ensurePartition(computeMonthPartitionRange(referenceDate, monthOffset));
    }
  }

  private async ensurePartition({
    partitionName,
    fromDate,
    toDateExclusive,
  }: MonthPartitionRange): Promise<void> {
    try {
      // Bounds are computed UTC dates (not user input) pinned to `+00`, so the
      // partition boundaries are absolute UTC instants regardless of the session
      // timezone — matching the UTC `created_at` values. The partition name is
      // derived from the same dates; identifiers are quoted.
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "orders" ` +
          `FOR VALUES FROM ('${fromDate} 00:00:00+00') TO ('${toDateExclusive} 00:00:00+00')`,
      );
      this.logger.log(`Ensured order partition ${partitionName} [${fromDate}, ${toDateExclusive})`);
    } catch (error) {
      this.logger.error(
        `Failed to ensure order partition ${partitionName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private isDisabled(): boolean {
    return this.config.get<string>('NODE_ENV') === 'test';
  }
}
