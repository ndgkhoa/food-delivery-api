import type { DataSource } from 'typeorm';

/** Outcome of `withAdvisoryLock`: `ran: false` means the lock was contended and `fn` never executed. */
export type AdvisoryLockOutcome<T> = { ran: true; result: T } | { ran: false };

/**
 * Runs `fn` while holding a session-level Postgres advisory lock (`pg_try_advisory_lock`),
 * so overlapping callers — e.g. one relay per replica polling the same table — serialize
 * instead of racing. Unlike the `_xact_` variant, a session-level lock is held across the
 * FULL lifetime of `fn` on a connection dedicated to just this call, not tied to a single
 * statement or transaction, which is what lets `fn` itself open its own transactions
 * (fetch → publish → mark-done) without releasing the lock partway through.
 *
 * Acquisition is non-blocking: if another caller already holds `lockKey`, this returns
 * `{ ran: false }` immediately instead of queuing — the caller should just try again on
 * its next cycle rather than pile up waiters. The dedicated connection is always released,
 * even if `fn` throws.
 */
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
