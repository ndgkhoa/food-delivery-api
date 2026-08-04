import Redis from 'ioredis';
import { REDIS_URL } from './delivery-e2e-config';

export async function flushTenantKeys(...tenantIds: string[]): Promise<void> {
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  try {
    for (const tenantId of tenantIds) {
      const keys = await redis.keys(`*${tenantId}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  } finally {
    redis.disconnect();
  }
}
