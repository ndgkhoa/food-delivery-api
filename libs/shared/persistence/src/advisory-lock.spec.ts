import type { DataSource, QueryRunner } from 'typeorm';
import { withAdvisoryLock } from './advisory-lock';

function fakeDataSource(tryLockResult: boolean): {
  dataSource: DataSource;
  queryRunner: QueryRunner;
  queryCalls: unknown[][];
} {
  const queryCalls: unknown[][] = [];
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queryCalls.push([sql, params]);
      if (sql.startsWith('SELECT pg_try_advisory_lock')) {
        return [{ pg_try_advisory_lock: tryLockResult }];
      }
      return [];
    }),
    release: jest.fn().mockResolvedValue(undefined),
  } as unknown as QueryRunner;

  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
  } as unknown as DataSource;

  return { dataSource, queryRunner, queryCalls };
}

describe('withAdvisoryLock', () => {
  it('acquires the lock, runs fn, then unlocks and releases in order', async () => {
    const { dataSource, queryRunner, queryCalls } = fakeDataSource(true);
    const callOrder: string[] = [];
    const fn = jest.fn(async () => {
      callOrder.push('fn');
      return 'drained';
    });

    const outcome = await withAdvisoryLock(dataSource, 4001, fn);

    expect(outcome).toEqual({ ran: true, result: 'drained' });
    expect(queryRunner.connect).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['fn']);
    expect(queryCalls[0][0]).toContain('pg_try_advisory_lock');
    expect(queryCalls[0][1]).toEqual([4001]);
    expect(queryCalls[1][0]).toContain('pg_advisory_unlock');
    expect(queryCalls[1][1]).toEqual([4001]);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('skips fn and returns ran:false when the lock is already held', async () => {
    const { dataSource, queryRunner, queryCalls } = fakeDataSource(false);
    const fn = jest.fn();

    const outcome = await withAdvisoryLock(dataSource, 4001, fn);

    expect(outcome).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
    expect(queryCalls).toHaveLength(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('still unlocks and releases the connection when fn throws', async () => {
    const { dataSource, queryRunner, queryCalls } = fakeDataSource(true);
    const fn = jest.fn().mockRejectedValue(new Error('publish failed'));

    await expect(withAdvisoryLock(dataSource, 4001, fn)).rejects.toThrow('publish failed');

    expect(queryCalls.some(([sql]) => (sql as string).includes('pg_advisory_unlock'))).toBe(true);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('releases the connection even if connect() succeeds but query() throws', async () => {
    const { dataSource, queryRunner } = fakeDataSource(true);
    (queryRunner.query as jest.Mock).mockRejectedValueOnce(new Error('connection reset'));

    await expect(withAdvisoryLock(dataSource, 4001, jest.fn())).rejects.toThrow('connection reset');

    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
