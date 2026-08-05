import { OBJECT_STORAGE } from '@media/domain/media/object-storage.port';
import { BucketBootstrap } from '@media/infrastructure/minio/bucket-bootstrap';
import { MinioClientModule } from '@media/infrastructure/minio/minio-client.module';
import { MinioObjectStorage } from '@media/infrastructure/minio/minio-object-storage.adapter';
import { Module } from '@nestjs/common';

@Module({
  imports: [MinioClientModule],
  providers: [{ provide: OBJECT_STORAGE, useClass: MinioObjectStorage }, BucketBootstrap],
  exports: [OBJECT_STORAGE],
})
export class MinioStorageModule {}
