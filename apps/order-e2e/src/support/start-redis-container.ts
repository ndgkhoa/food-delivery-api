import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export interface StartedRedis {
  container: StartedTestContainer;
  url: string;
}

/**
 * Spins up a real, throwaway Redis via testcontainers so the in-process
 * inventory microservice's distributed lock runs against genuine `SET NX PX`
 * + `EVAL` semantics, exactly as it would in production.
 */
export async function startRedisContainer(): Promise<StartedRedis> {
  const container = await new GenericContainer('redis:8.8.0-alpine').withExposedPorts(6379).start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  return { container, url };
}
