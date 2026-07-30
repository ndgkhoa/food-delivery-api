import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { readFromMaster, readFromSlave } from './replicated-query-runner';

function fakeDataSource(): { dataSource: DataSource; queryRunner: QueryRunner } {
  const queryRunner = {
    manager: { mode: 'fake-manager' } as unknown as EntityManager,
    release: jest.fn().mockResolvedValue(undefined),
  } as unknown as QueryRunner;

  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
  } as unknown as DataSource;

  return { dataSource, queryRunner };
}

describe('readFromMaster', () => {
  it('creates a master-mode query runner and hands its manager to the callback', async () => {
    const { dataSource, queryRunner } = fakeDataSource();

    const result = await readFromMaster(dataSource, async (manager) => {
      expect(manager).toBe(queryRunner.manager);
      return 'read-your-write';
    });

    expect(dataSource.createQueryRunner).toHaveBeenCalledWith('master');
    expect(result).toBe('read-your-write');
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('still releases the query runner when the callback throws', async () => {
    const { dataSource, queryRunner } = fakeDataSource();

    await expect(
      readFromMaster(dataSource, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});

describe('readFromSlave', () => {
  it('creates a slave-mode query runner for lag-tolerant reads', async () => {
    const { dataSource, queryRunner } = fakeDataSource();

    await readFromSlave(dataSource, async () => 'history');

    expect(dataSource.createQueryRunner).toHaveBeenCalledWith('slave');
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('re-throws a NON-connection error without falling back to master', async () => {
    const { dataSource, queryRunner } = fakeDataSource();

    await expect(
      readFromSlave(dataSource, async () => {
        throw new Error('boom'); // a genuine query bug, not a connection failure
      }),
    ).rejects.toThrow('boom');

    // Only the slave runner was created — no master fallback for a real error.
    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(dataSource.createQueryRunner).toHaveBeenCalledWith('slave');
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('falls back to master when the replica is unreachable (connection error)', async () => {
    const { dataSource } = fakeDataSource();
    const work = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('replica down'), { code: 'ECONNREFUSED' }))
      .mockResolvedValueOnce('from-master');

    const result = await readFromSlave(dataSource, work);

    expect(result).toBe('from-master');
    expect(dataSource.createQueryRunner).toHaveBeenNthCalledWith(1, 'slave');
    expect(dataSource.createQueryRunner).toHaveBeenNthCalledWith(2, 'master');
  });
});
