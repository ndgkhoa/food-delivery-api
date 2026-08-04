import { MINIO_CLIENT } from '@media/infrastructure/minio/minio.tokens';
import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

const minioClientProvider: Provider = {
  provide: MINIO_CLIENT,
  useFactory: (config: ConfigService): Client =>
    new Client({
      endPoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: config.getOrThrow<number>('MINIO_PORT'),
      useSSL: config.getOrThrow<boolean>('MINIO_USE_SSL'),
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
    }),
  inject: [ConfigService],
};

@Module({
  providers: [minioClientProvider],
  exports: [MINIO_CLIENT],
})
export class MinioClientModule {}
