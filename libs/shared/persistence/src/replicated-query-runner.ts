import type { DataSource, EntityManager } from 'typeorm';

export type ReplicationQueryMode = 'master' | 'slave';

/**
 * Runs `work` against an `EntityManager` explicitly pinned to `mode` — bypassing
 * whatever `replication.defaultMode` the data source was built with — and
 * always releases the underlying query runner, even if `work` throws.
 */
async function runReplicatedQuery<T>(
  dataSource: DataSource,
  mode: ReplicationQueryMode,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner(mode);
  try {
    return await work(queryRunner.manager);
  } finally {
    await queryRunner.release();
  }
}

/**
 * Read-your-writes escape hatch: forces a read onto the replication master so
 * a write this request (or a very recent prior one, e.g. an idempotency-key
 * replay) just committed is always visible — regardless of the data source's
 * default read routing. Use for any read of a row the same caller may have
 * just written (a just-placed order, an idempotency-key lookup, a saga
 * reading its own state, an optimistic-lock reload).
 */
export function readFromMaster<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return runReplicatedQuery(dataSource, 'master', work);
}

/**
 * SQLSTATE connection-exception class (08…) + the node/libpq socket error codes
 * that mean "the replica is unreachable", as opposed to a genuine query error.
 */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EPIPE',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
]);

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code != null && (code.startsWith('08') || CONNECTION_ERROR_CODES.has(code));
}

/**
 * Opts a genuinely lag-tolerant read (a list/history query over rows the
 * caller did NOT just write) into the replica pool, offloading it from the
 * master even when the data source's `defaultMode` is `'master'`. If the
 * replica is UNREACHABLE (connection-class error), it transparently falls back
 * to master — serving the read lag-free rather than failing the request —
 * because TypeORM does no health-check or master failover for a slave-pinned
 * runner. A genuine query error is NOT a connection error and still surfaces.
 */
export async function readFromSlave<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  try {
    return await runReplicatedQuery(dataSource, 'slave', work);
  } catch (error) {
    if (isConnectionError(error)) {
      return runReplicatedQuery(dataSource, 'master', work);
    }
    throw error;
  }
}
