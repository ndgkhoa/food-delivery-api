import { DEMO_IMAGE_CONTENT_TYPE, generateDemoImage } from './demo-image-fixture';
import { ApiError, type GatewayClient } from './gateway-api-client';
import type { SeedState } from './seed-state-store';

interface CreateUploadResponse {
  id: string;
  objectKey: string;
  uploadUrl: string;
}

/**
 * Drives the media service's real presigned-upload flow end to end (see
 * `apps/media/src/interface/http/media.controller.ts` +
 * `apps/media/src/application/create-upload.handler.ts`):
 *   1. `POST /media/uploads` (through the gateway, as `caller`) — declares
 *      content-type + size, gets back a presigned PUT URL.
 *   2. `PUT` the actual placeholder PNG bytes straight to that URL — this
 *      goes DIRECTLY to MinIO, never through the gateway, mirroring how a
 *      real client transfers.
 *   3. `POST /media/uploads/:id/complete` — the service re-stats the object
 *      in MinIO and advances PENDING → UPLOADED.
 */
export async function uploadDemoMedia(
  caller: GatewayClient,
  tenantId: string,
  state: SeedState,
  label: string,
  index: number,
): Promise<void> {
  console.log(`  uploading a demo media image ("${label}")...`);
  const body = await generateDemoImage(label, index);

  const created = await caller.request<CreateUploadResponse>(
    'create media upload',
    'POST',
    '/media/uploads',
    { contentType: DEMO_IMAGE_CONTENT_TYPE, sizeBytes: body.length },
  );

  const putResponse = await fetch(created.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': DEMO_IMAGE_CONTENT_TYPE },
    body,
  });
  if (!putResponse.ok) {
    const text = await putResponse.text();
    throw new ApiError('PUT demo image bytes to presigned URL', putResponse.status, text);
  }

  await caller.request(
    `complete media upload ${created.id}`,
    'POST',
    `/media/uploads/${created.id}/complete`,
  );
  state.media.push({ id: created.id, tenantId, objectKey: created.objectKey });
  console.log(`  uploaded media ${created.id}`);
}
