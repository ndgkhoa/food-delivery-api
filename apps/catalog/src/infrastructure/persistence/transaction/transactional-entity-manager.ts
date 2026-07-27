import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';

/**
 * Carries the active transactional `EntityManager` through the async call
 * chain so repositories and the audit adapter can enlist in the current
 * transaction without threading a manager through every method signature.
 * Empty outside a transaction — callers then fall back to the default manager.
 */
const storage = new AsyncLocalStorage<EntityManager>();

export function runWithEntityManager<T>(
  manager: EntityManager,
  work: () => Promise<T>,
): Promise<T> {
  return storage.run(manager, work);
}

/** Returns the transactional manager when inside `runInTransaction`, else undefined. */
export function getTransactionalEntityManager(): EntityManager | undefined {
  return storage.getStore();
}
