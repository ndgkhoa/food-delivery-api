import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Media service env: the base 12-factor vars (incl. the DB_* block, since media
 * owns a Postgres database `media`) plus MinIO object-storage coordinates, the
 * upload policy (MIME allowlist + size ceiling), presigned-URL TTL, thumbnail
 * width, and the Redis URL for the BullMQ thumbnail queue. `PORT` defaults to
 * 3006 (gateway 3000, catalog 3001, auth 3002, order 3003, search 3004,
 * delivery 3005).
 */
export const mediaEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3006),
  DB_NAME: z.string().min(1).default('media'),
  /** MinIO host (no scheme) — the S3 API endpoint the client connects to. */
  MINIO_ENDPOINT: z.string().min(1).default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().min(1).default('minioadmin'),
  MINIO_SECRET_KEY: z.string().min(1).default('minioadmin'),
  /**
   * TLS toggle for the MinIO connection. `enum().transform` rather than
   * `coerce.boolean` because coercion treats the string "false" as truthy.
   */
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Bucket all media objects live in — auto-created on boot if absent. */
  MEDIA_BUCKET: z.string().min(1).default('media'),
  /** Lifetime of every issued presigned URL (upload + download). Short by design. */
  PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /** Hard ceiling on a declared upload size — enforced before a PUT URL is issued. */
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_000_000),
  /** Comma-separated MIME allowlist for uploads. */
  ALLOWED_MIME: z.string().min(1).default('image/jpeg,image/png,image/webp'),
  /** Target width (px) of the generated thumbnail; height scales to preserve aspect. */
  THUMBNAIL_WIDTH: z.coerce.number().int().positive().default(200),
  /** Redis connection string backing the BullMQ thumbnail queue + worker. */
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
});
