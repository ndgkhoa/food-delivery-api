import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  RolesGuard,
  TenancyModule,
  TrustedIdentityInterceptor,
} from '@food-delivery-api/shared-tenancy';
import { CompleteUploadHandler } from '@media/application/complete-upload.handler';
import { CreateUploadHandler } from '@media/application/create-upload.handler';
import { GenerateThumbnailHandler } from '@media/application/generate-thumbnail.handler';
import { GetMediaHandler } from '@media/application/get-media.handler';
import { mediaEnvSchema } from '@media/config/media-env-schema';
import { ImageProcessingModule } from '@media/infrastructure/image/image-processing.module';
import { MinioStorageModule } from '@media/infrastructure/minio/minio-storage.module';
import { PersistenceModule } from '@media/infrastructure/persistence/persistence.module';
import { ThumbnailQueueModule } from '@media/infrastructure/queue/thumbnail-queue.module';
import { MediaController } from '@media/interface/http/media.controller';
import { ThumbnailWorker } from '@media/interface/queue/thumbnail.worker';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    SharedConfigModule.forRoot(mediaEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    TenancyModule,
    PersistenceModule,
    MinioStorageModule,
    ThumbnailQueueModule,
    ImageProcessingModule,
  ],
  controllers: [MediaController],
  providers: [
    CreateUploadHandler,
    CompleteUploadHandler,
    GetMediaHandler,
    GenerateThumbnailHandler,
    ThumbnailWorker,
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
  ],
})
export class AppModule {}
