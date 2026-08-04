import type { ImageProcessorPort } from '@media/domain/media/image-processor.port';
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

@Injectable()
export class SharpImageProcessor implements ImageProcessorPort {
  resizeToWidth(input: Buffer, width: number): Promise<Buffer> {
    return sharp(input).resize({ width, withoutEnlargement: true }).toBuffer();
  }
}
