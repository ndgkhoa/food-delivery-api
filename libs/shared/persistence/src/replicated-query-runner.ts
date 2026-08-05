import type { DataSource, EntityManager } from 'typeorm';

export type ReplicationQueryMode = 'master' | 'slave';

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

export function readFromMaster<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return runReplicatedQuery(dataSource, 'master', work);
}

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
