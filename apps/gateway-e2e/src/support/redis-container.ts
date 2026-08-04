import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

const REDIS_IMAGE = 'redis:8.8.0-alpine';

export interface RedisHandle {
  container: StartedTestContainer;
  url: string;
}

export async function startRedis(): Promise<RedisHandle> {
  const container = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .withStartupTimeout(60_000)
    .start();

  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  return { container, url };
}

export async function stopRedis(handle: RedisHandle): Promise<void> {
  await handle.container.stop();
}
