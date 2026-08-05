import {
  computeMonthPartitionRange,
  OrdersPartitionMaintenanceService,
} from '@order/infrastructure/persistence/partitioning/orders-partition-maintenance';

describe('computeMonthPartitionRange', () => {
  it('returns the reference month bounds at offset 0', () => {
    expect(computeMonthPartitionRange(new Date('2026-07-15T10:00:00Z'), 0)).toEqual({
      partitionName: 'orders_p202607',
      fromDate: '2026-07-01',
      toDateExclusive: '2026-08-01',
    });
  });

  it('returns the following month bounds at offset 1', () => {
    expect(computeMonthPartitionRange(new Date('2026-07-15T10:00:00Z'), 1)).toEqual({
      partitionName: 'orders_p202608',
      fromDate: '2026-08-01',
      toDateExclusive: '2026-09-01',
    });
  });

  it('rolls over the year at offset 1 in December', () => {
    expect(computeMonthPartitionRange(new Date('2026-12-31T23:59:59Z'), 1)).toEqual({
      partitionName: 'orders_p202701',
      fromDate: '2027-01-01',
      toDateExclusive: '2027-02-01',
    });
  });

  it('is stable regardless of the day-of-month component', () => {
    const first = computeMonthPartitionRange(new Date('2026-02-01T00:00:00Z'), 1);
    const last = computeMonthPartitionRange(new Date('2026-02-28T23:59:59Z'), 1);
    expect(first).toEqual(last);
  });
});

describe('OrdersPartitionMaintenanceService', () => {
  function buildService(nodeEnv: string | undefined, dataSourceQuery: jest.Mock) {
    const config = { get: () => nodeEnv } as unknown as import('@nestjs/config').ConfigService;
    const dataSource = { query: dataSourceQuery } as unknown as import('typeorm').DataSource;
    return new OrdersPartitionMaintenanceService(dataSource, config);
  }

  it('skips ensuring partitions on bootstrap when NODE_ENV=test', async () => {
    const query = jest.fn();
    await buildService('test', query).onApplicationBootstrap();
    expect(query).not.toHaveBeenCalled();
  });

  it('ensures the CURRENT and NEXT month partitions on bootstrap outside test', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const service = buildService('production', query);

    await service.ensureUpcomingPartitions(new Date('2026-07-15T00:00:00Z'));

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('"orders_p202607"');
    expect(query.mock.calls[1][0]).toContain('"orders_p202608"');
  });

  it('pins partition bounds to UTC (+00) so they are session-timezone independent', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await buildService('production', query).ensureUpcomingPartitions(
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(query.mock.calls[0][0]).toContain("FROM ('2026-07-01 00:00:00+00')");
    expect(query.mock.calls[0][0]).toContain("TO ('2026-08-01 00:00:00+00')");
  });

  it('skips the monthly cron tick when NODE_ENV=test', async () => {
    const query = jest.fn();
    await buildService('test', query).monthlyMaintenance();
    expect(query).not.toHaveBeenCalled();
  });

  it('is idempotent — each partition uses CREATE TABLE IF NOT EXISTS', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await buildService('production', query).ensureUpcomingPartitions(
      new Date('2026-07-15T00:00:00Z'),
    );
    for (const call of query.mock.calls) {
      expect(call[0]).toContain('CREATE TABLE IF NOT EXISTS');
    }
  });

  it('logs and swallows a query failure rather than throwing (boot must not crash on a maintenance DDL error)', async () => {
    const query = jest.fn().mockRejectedValue(new Error('permission denied'));
    await expect(
      buildService('production', query).ensureUpcomingPartitions(new Date('2026-07-15T00:00:00Z')),
    ).resolves.toBeUndefined();
  });
});
