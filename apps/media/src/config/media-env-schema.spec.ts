import { mediaEnvSchema } from '@media/config/media-env-schema';

describe('mediaEnvSchema', () => {
  const dbEnv = {
    DB_HOST: 'localhost',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'postgres',
  };

  it('applies media-specific defaults with an otherwise minimal env', () => {
    const env = mediaEnvSchema.parse(dbEnv);

    expect(env.PORT).toBe(3006);
    expect(env.DB_NAME).toBe('media');
    expect(env.MINIO_ENDPOINT).toBe('localhost');
    expect(env.MINIO_PORT).toBe(9000);
    expect(env.MEDIA_BUCKET).toBe('media');
    expect(env.PRESIGN_TTL_SECONDS).toBe(300);
    expect(env.MAX_UPLOAD_BYTES).toBe(5_000_000);
    expect(env.ALLOWED_MIME).toBe('image/jpeg,image/png,image/webp');
    expect(env.THUMBNAIL_WIDTH).toBe(200);
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('treats the string "false" as a real boolean false for MINIO_USE_SSL', () => {
    expect(mediaEnvSchema.parse({ ...dbEnv, MINIO_USE_SSL: 'false' }).MINIO_USE_SSL).toBe(false);
    expect(mediaEnvSchema.parse({ ...dbEnv, MINIO_USE_SSL: 'true' }).MINIO_USE_SSL).toBe(true);
    expect(mediaEnvSchema.parse(dbEnv).MINIO_USE_SSL).toBe(false);
  });

  it('coerces numeric envs from strings and honours overrides', () => {
    const env = mediaEnvSchema.parse({
      ...dbEnv,
      PORT: '4200',
      MAX_UPLOAD_BYTES: '1000000',
      THUMBNAIL_WIDTH: '320',
    });
    expect(env.PORT).toBe(4200);
    expect(env.MAX_UPLOAD_BYTES).toBe(1_000_000);
    expect(env.THUMBNAIL_WIDTH).toBe(320);
  });

  it('rejects a non-URL Redis connection string', () => {
    expect(() => mediaEnvSchema.parse({ ...dbEnv, REDIS_URL: 'not-a-url' })).toThrow();
  });
});
