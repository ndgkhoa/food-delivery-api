import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export interface StartedRedis {
  container: StartedTestContainer;
  url: string;
}

export async function startRedisContainer(): Promise<StartedRedis> {
  const container = await new GenericContainer('redis:8.8.0-alpine').withExposedPorts(6379).start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  return { container, url };
}
