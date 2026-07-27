import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export interface StartedRedis {
  container: StartedTestContainer;
  url: string;
}

/**
 * Spins up a real, throwaway Redis via testcontainers so the distributed lock
 * runs against genuine `SET NX PX` + `EVAL` semantics — the same primitives the
 * no-oversell proof depends on.
 */
export async function startRedisContainer(): Promise<StartedRedis> {
  const container = await new GenericContainer('redis:8.8.0-alpine').withExposedPorts(6379).start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  return { container, url };
}
