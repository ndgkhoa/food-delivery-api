/**
 * Port over image resizing. Keeps the sharp dependency out of the application
 * layer — the generate-thumbnail use case orchestrates through this port, and
 * the sharp adapter lives in infrastructure.
 */
export interface ImageProcessorPort {
  /** Resizes to the given width (aspect-preserving), returning the encoded bytes. */
  resizeToWidth(input: Buffer, width: number): Promise<Buffer>;
}

export const IMAGE_PROCESSOR = Symbol('ImageProcessorPort');
