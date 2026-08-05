import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const mediaEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3006),
  DB_NAME: z.string().min(1).default('media'),
  MINIO_ENDPOINT: z.string().min(1).default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().min(1).default('minioadmin'),
  MINIO_SECRET_KEY: z.string().min(1).default('minioadmin'),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MEDIA_BUCKET: z.string().min(1).default('media'),
  PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_000_000),
  ALLOWED_MIME: z.string().min(1).default('image/jpeg,image/png,image/webp'),
  THUMBNAIL_WIDTH: z.coerce.number().int().positive().default(200),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
});
