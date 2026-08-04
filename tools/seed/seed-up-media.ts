import { DEMO_IMAGE_CONTENT_TYPE, generateDemoImage } from './demo-image-fixture';
import { ApiError, type GatewayClient } from './gateway-api-client';
import type { SeedState } from './seed-state-store';

interface CreateUploadResponse {
  id: string;
  objectKey: string;
  uploadUrl: string;
}

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
