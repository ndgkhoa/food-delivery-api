/** Bare connection credentials for one Postgres endpoint (master or a replica). */
export interface ReplicatedPostgresConnectionOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/**
 * The `type`/`replication` slice of a TypeORM `DataSourceOptions` a consuming
 * service spreads together with its own `entities`/`migrations`/`synchronize`.
 */
export interface ReplicatedPostgresDataSourceFragment {
  type: 'postgres';
  replication: {
    /**
     * `'master'` (NOT TypeORM's own default of `'slave'`) — every read stays
     * on the master unless a caller explicitly opts a specific query into the
     * replica pool via {@link readFromSlave} from `./replicated-query-runner`.
     * This makes read-your-writes correctness the default for every existing
     * (and future) repository call, instead of something each call site has
     * to remember to force.
     */
    defaultMode: 'master';
    master: ReplicatedPostgresConnectionOptions;
    slaves: ReplicatedPostgresConnectionOptions[];
  };
}

export interface ReplicatedPostgresEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  /**
   * Streaming read-replica host. Unset/empty (the single-node dev default)
   * means no replica is configured — the slave pool falls back to the master
   * connection itself, so every read still lands on the one real database and
   * behaviour is unchanged from before this feature existed.
   */
  DB_REPLICA_HOST?: string;
  /** Streaming read-replica port. Only consulted when `DB_REPLICA_HOST` is set. */
  DB_REPLICA_PORT?: number;
}

/**
 * Builds the replication fragment of a Postgres `DataSourceOptions`, shared by
 * every service that adopts a read replica. See {@link ReplicatedPostgresDataSourceFragment.replication}
 * for why the default read destination is the master, not a slave.
 */
export function buildReplicatedDataSourceOptions(
  env: ReplicatedPostgresEnv,
): ReplicatedPostgresDataSourceFragment {
  const master: ReplicatedPostgresConnectionOptions = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  };

  const replicaHost = env.DB_REPLICA_HOST?.trim();
  const slave: ReplicatedPostgresConnectionOptions = replicaHost
    ? { ...master, host: replicaHost, port: env.DB_REPLICA_PORT ?? env.DB_PORT }
    : master;

  return {
    type: 'postgres',
    replication: { defaultMode: 'master', master, slaves: [slave] },
  };
}
