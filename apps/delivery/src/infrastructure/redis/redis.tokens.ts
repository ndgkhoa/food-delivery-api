/** DI token for the shared ioredis client (the `core`-profile Redis at REDIS_URL). */
export const REDIS_CLIENT = Symbol('RedisClient');
