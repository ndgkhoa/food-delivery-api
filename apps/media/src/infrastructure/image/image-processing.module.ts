import { IMAGE_PROCESSOR } from '@media/domain/media/image-processor.port';
import { SharpImageProcessor } from '@media/infrastructure/image/sharp-image-processor.adapter';
import { Module } from '@nestjs/common';

@Module({
  providers: [{ provide: IMAGE_PROCESSOR, useClass: SharpImageProcessor }],
  exports: [IMAGE_PROCESSOR],
})
export class ImageProcessingModule {}
