import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export interface MonthPartitionRange {
  partitionName: string;
  fromDate: string;
  toDateExclusive: string;
}

export function computeMonthPartitionRange(
  referenceDate: Date,
  monthOffset: number,
): MonthPartitionRange {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
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

  @Cron('0 0 1 * *')
  async monthlyMaintenance(): Promise<void> {
    if (this.isDisabled()) {
      return;
    }
    await this.ensureUpcomingPartitions();
  }

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
