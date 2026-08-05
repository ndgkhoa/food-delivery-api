export interface ReplicatedPostgresConnectionOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface ReplicatedPostgresDataSourceFragment {
  type: 'postgres';
  replication: {
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
  DB_REPLICA_HOST?: string;
  DB_REPLICA_PORT?: number;
}

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
