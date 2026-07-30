import { buildReplicatedDataSourceOptions } from './replicated-datasource-options';

const baseEnv = {
  DB_HOST: 'primary.internal',
  DB_PORT: 5432,
  DB_USERNAME: 'app',
  DB_PASSWORD: 'secret',
  DB_NAME: 'order',
};

describe('buildReplicatedDataSourceOptions', () => {
  it('always routes non-transactional reads to master by default', () => {
    const options = buildReplicatedDataSourceOptions(baseEnv);

    expect(options.type).toBe('postgres');
    expect(options.replication.defaultMode).toBe('master');
  });

  it('points the master connection at DB_* regardless of a configured replica', () => {
    const options = buildReplicatedDataSourceOptions({
      ...baseEnv,
      DB_REPLICA_HOST: 'replica.internal',
      DB_REPLICA_PORT: 5433,
    });

    expect(options.replication.master).toEqual({
      host: 'primary.internal',
      port: 5432,
      username: 'app',
      password: 'secret',
      database: 'order',
    });
  });

  it('points the slave pool at DB_REPLICA_* when a replica host is configured', () => {
    const options = buildReplicatedDataSourceOptions({
      ...baseEnv,
      DB_REPLICA_HOST: 'replica.internal',
      DB_REPLICA_PORT: 5433,
    });

    expect(options.replication.slaves).toEqual([
      {
        host: 'replica.internal',
        port: 5433,
        username: 'app',
        password: 'secret',
        database: 'order',
      },
    ]);
  });

  it('defaults the replica port to DB_PORT when only DB_REPLICA_HOST is set', () => {
    const options = buildReplicatedDataSourceOptions({
      ...baseEnv,
      DB_REPLICA_HOST: 'replica.internal',
    });

    expect(options.replication.slaves[0]?.port).toBe(baseEnv.DB_PORT);
  });

  it('falls back the slave pool to the master connection when DB_REPLICA_HOST is unset (single-node dev)', () => {
    const options = buildReplicatedDataSourceOptions(baseEnv);

    expect(options.replication.slaves).toEqual([options.replication.master]);
  });

  it('falls back to master when DB_REPLICA_HOST is blank/whitespace', () => {
    const options = buildReplicatedDataSourceOptions({ ...baseEnv, DB_REPLICA_HOST: '   ' });

    expect(options.replication.slaves).toEqual([options.replication.master]);
  });
});
