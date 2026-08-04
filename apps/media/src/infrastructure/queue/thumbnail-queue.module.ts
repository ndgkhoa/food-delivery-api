import { THUMBNAIL_QUEUE } from '@media/domain/media/thumbnail-queue.port';
import { BullMqThumbnailQueue } from '@media/infrastructure/queue/bullmq-thumbnail-queue.adapter';
import { Module } from '@nestjs/common';

@Module({
  providers: [{ provide: THUMBNAIL_QUEUE, useClass: BullMqThumbnailQueue }],
  exports: [THUMBNAIL_QUEUE],
})
export class ThumbnailQueueModule {}
