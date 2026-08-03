import type { ImageProcessorPort } from '@media/domain/media/image-processor.port';
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

/**
 * sharp adapter for the image-processor port. `withoutEnlargement` keeps a
 * source already narrower than the target width from being upscaled, so a
 * thumbnail is never larger than the original.
 */
@Injectable()
export class SharpImageProcessor implements ImageProcessorPort {
  resizeToWidth(input: Buffer, width: number): Promise<Buffer> {
    return sharp(input).resize({ width, withoutEnlargement: true }).toBuffer();
  }
}
