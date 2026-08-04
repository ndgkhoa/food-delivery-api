import 'reflect-metadata';
import { makePng } from './png-fixture';

const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL ?? 'http://localhost:3006/api/v1';

const tenantA = '77777777-7777-4777-8777-777777777777';
const tenantB = '88888888-8888-4888-8888-888888888888';

const headersFor = (tenantId: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-tenant-id': tenantId,
  'x-user-id': `user-${tenantId.slice(0, 8)}`,
  'x-roles': 'customer',
});

interface CreateUploadResponse {
  id: string;
  objectKey: string;
  uploadUrl: string;
}
interface MediaResponse {
  id: string;
  status: 'PENDING' | 'UPLOADED' | 'READY';
  url: string;
  thumbnailUrl?: string;
}

async function waitUntil<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== undefined) {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for media to become READY');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function contentLength(url: string): Promise<number> {
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = Buffer.from(await res.arrayBuffer());
  return body.length;
}

describe('Media upload → thumbnail → presigned get (e2e, compose)', () => {
  it('uploads directly to MinIO, generates a smaller thumbnail, and serves both via presigned URLs', async () => {
    const png = makePng(512, 512);

    const createRes = await fetch(`${MEDIA_BASE_URL}/media/uploads`, {
      method: 'POST',
      headers: headersFor(tenantA),
      body: JSON.stringify({ contentType: 'image/png', sizeBytes: png.length }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CreateUploadResponse;
    expect(created.objectKey.startsWith(`${tenantA}/`)).toBe(true);

    const putRes = await fetch(created.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    expect(putRes.status).toBe(200);

    const completeRes = await fetch(`${MEDIA_BASE_URL}/media/uploads/${created.id}/complete`, {
      method: 'POST',
      headers: headersFor(tenantA),
    });
    expect(completeRes.status).toBe(201);

    const ready = await waitUntil(async () => {
      const res = await fetch(`${MEDIA_BASE_URL}/media/${created.id}`, {
        headers: headersFor(tenantA),
      });
      if (res.status !== 200) {
        return undefined;
      }
      const media = (await res.json()) as MediaResponse;
      return media.status === 'READY' && media.thumbnailUrl ? media : undefined;
    });

    const originalSize = await contentLength(ready.url);
    const thumbnailSize = await contentLength(ready.thumbnailUrl as string);
    expect(thumbnailSize).toBeLessThan(originalSize);
  }, 60_000);

  it('rejects a disallowed MIME and an over-size upload before issuing a URL', async () => {
    const disallowed = await fetch(`${MEDIA_BASE_URL}/media/uploads`, {
      method: 'POST',
      headers: headersFor(tenantA),
      body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 1_000 }),
    });
    expect(disallowed.status).toBe(400);

    const oversize = await fetch(`${MEDIA_BASE_URL}/media/uploads`, {
      method: 'POST',
      headers: headersFor(tenantA),
      body: JSON.stringify({ contentType: 'image/png', sizeBytes: 50_000_000 }),
    });
    expect(oversize.status).toBe(400);
  });

  it('isolates tenants: tenant B cannot complete or get tenant A’s object', async () => {
    const png = makePng(64, 64);
    const createRes = await fetch(`${MEDIA_BASE_URL}/media/uploads`, {
      method: 'POST',
      headers: headersFor(tenantA),
      body: JSON.stringify({ contentType: 'image/png', sizeBytes: png.length }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CreateUploadResponse;

    await fetch(created.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: png,
    });

    const completeAsB = await fetch(`${MEDIA_BASE_URL}/media/uploads/${created.id}/complete`, {
      method: 'POST',
      headers: headersFor(tenantB),
    });
    expect(completeAsB.status).toBe(404);

    const getAsB = await fetch(`${MEDIA_BASE_URL}/media/${created.id}`, {
      headers: headersFor(tenantB),
    });
    expect(getAsB.status).toBe(404);
  }, 30_000);
});
