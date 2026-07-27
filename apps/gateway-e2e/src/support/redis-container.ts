import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

// Same image the `core` compose profile pins, so the e2e exercises the exact
// Redis the gateway rate-limits against in dev.
const REDIS_IMAGE = 'redis:8.8.0-alpine';

export interface RedisHandle {
  container: StartedTestContainer;
  /** e.g. `redis://localhost:54999` — passed to the gateway as REDIS_URL. */
  url: string;
}

/** Boots a throwaway Redis and waits until it accepts connections. */
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
