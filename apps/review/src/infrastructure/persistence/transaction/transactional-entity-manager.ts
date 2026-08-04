import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';

const storage = new AsyncLocalStorage<EntityManager>();

export function runWithEntityManager<T>(
  manager: EntityManager,
  work: () => Promise<T>,
): Promise<T> {
  return storage.run(manager, work);
}

export function getTransactionalEntityManager(): EntityManager | undefined {
  return storage.getStore();
}
