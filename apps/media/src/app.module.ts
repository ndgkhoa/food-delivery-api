import { SharedConfigModule } from '@food-delivery-api/shared-config';
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
import { MediaExceptionFilter } from '@media/interface/http/filters/media-exception.filter';
import { MediaController } from '@media/interface/http/media.controller';
import { ThumbnailWorker } from '@media/interface/queue/thumbnail.worker';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

/**
 * Composition root: wires the domain ports (media repository, object storage,
 * thumbnail queue, image processor) to their infrastructure adapters, registers
 * the application use-case handlers, the HTTP controller, and the background
 * thumbnail worker. The only file allowed to import across every layer — see the
 * hexagonal rules in `.dependency-cruiser.js`.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(mediaEnvSchema),
    SharedLoggingModule.forRoot(),
    TenancyModule,
    PersistenceModule,
    MinioStorageModule,
    ThumbnailQueueModule,
    ImageProcessingModule,
  ],
  controllers: [MediaController],
  providers: [
    // Application use cases
    CreateUploadHandler,
    CompleteUploadHandler,
    GetMediaHandler,
    GenerateThumbnailHandler,
    // Background consumer of the thumbnail queue (drives GenerateThumbnailHandler)
    ThumbnailWorker,
    // RBAC on any @Roles-annotated route (none gated today; open to any
    // authenticated tenant). Runs before the interceptor, mirroring catalog.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Every route is tenant-scoped by default — the tenant comes from the verified
    // identity the gateway propagates (shared-tenancy), never a raw client header.
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
    // Maps media domain errors to HTTP statuses so use cases stay transport-agnostic.
    { provide: APP_FILTER, useClass: MediaExceptionFilter },
  ],
})
export class AppModule {}
