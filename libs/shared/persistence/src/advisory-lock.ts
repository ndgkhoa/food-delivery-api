import type { DataSource } from 'typeorm';

export type AdvisoryLockOutcome<T> = { ran: true; result: T } | { ran: false };

export async function withAdvisoryLock<T>(
  dataSource: DataSource,
  lockKey: number,
  fn: () => Promise<T>,
): Promise<AdvisoryLockOutcome<T>> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    const [{ pg_try_advisory_lock: acquired }] = await queryRunner.query(
      'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
      [lockKey],
    );
    if (!acquired) {
      return { ran: false };
    }
    try {
      const result = await fn();
      return { ran: true, result };
    } finally {
      await queryRunner.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    }
  } finally {
    await queryRunner.release();
  }
}
