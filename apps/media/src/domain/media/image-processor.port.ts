export interface ImageProcessorPort {
  resizeToWidth(input: Buffer, width: number): Promise<Buffer>;
}

export const IMAGE_PROCESSOR = Symbol('ImageProcessorPort');
