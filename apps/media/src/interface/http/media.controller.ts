import { CompleteUploadHandler } from '@media/application/complete-upload.handler';
import { CreateUploadHandler } from '@media/application/create-upload.handler';
import { GetMediaHandler } from '@media/application/get-media.handler';
import { CreateUploadRequest } from '@media/interface/http/dto/create-upload.request';
import type {
  CompleteUploadResponse,
  CreateUploadResponse,
  MediaResponse,
} from '@media/interface/http/dto/media.response';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';

/**
 * Media edge. Every route is tenant-scoped from the gateway-verified identity
 * (the global trusted-identity interceptor), never a raw client header. The app
 * never proxies bytes: create returns a presigned PUT the client uploads to
 * directly; get returns presigned GET URLs the client downloads from directly.
 */
@Controller('media')
export class MediaController {
  constructor(
    private readonly createUploadHandler: CreateUploadHandler,
    private readonly completeUploadHandler: CompleteUploadHandler,
    private readonly getMediaHandler: GetMediaHandler,
  ) {}

  @Post('uploads')
  createUpload(@Body() dto: CreateUploadRequest): Promise<CreateUploadResponse> {
    return this.createUploadHandler.execute(dto);
  }

  @Post('uploads/:id/complete')
  async complete(@Param('id', ParseUUIDPipe) id: string): Promise<CompleteUploadResponse> {
    const media = await this.completeUploadHandler.execute(id);
    return { id: media.id, status: media.status };
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<MediaResponse> {
    return this.getMediaHandler.execute(id);
  }
}
