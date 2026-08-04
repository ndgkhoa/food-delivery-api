export class LockContentionError extends Error {
  constructor(readonly key: string) {
    super(`Could not acquire lock for "${key}" — held by another caller`);
    this.name = 'LockContentionError';
  }
}
