import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

const CATALOG_BASE_URL = process.env.CATALOG_BASE_URL ?? 'http://localhost:3001/api/v1';
const SEARCH_BASE_URL = process.env.SEARCH_BASE_URL ?? 'http://localhost:3004/api/v1';

const tenantId = '77777777-7777-4777-8777-777777777777';
const otherTenantId = '88888888-8888-4888-8888-888888888888';

const ownerHeaders = {
  'content-type': 'application/json',
  'x-tenant-id': tenantId,
  'x-user-id': 'owner-search-e2e',
  'x-roles': 'restaurant-owner',
};
const otherTenantHeaders = { ...ownerHeaders, 'x-tenant-id': otherTenantId };

interface SearchHit {
  id: string;
  name: string;
}
interface SearchResponse {
  data: SearchHit[];
  total: number;
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
      throw new Error('Timed out waiting for search projection');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function search(query: string, headers: Record<string, string>): Promise<SearchResponse> {
  const res = await fetch(`${SEARCH_BASE_URL}/search/restaurants?q=${encodeURIComponent(query)}`, {
    headers,
  });
  if (res.status !== 200) {
    return { data: [], total: 0 };
  }
  return (await res.json()) as SearchResponse;
}

function findById(
  query: string,
  id: string,
  headers = ownerHeaders,
): () => Promise<SearchHit | undefined> {
  return async () => {
    const result = await search(query, headers);
    return result.data.find((hit) => hit.id === id);
  };
}

describe('Catalog events → search projection → Elasticsearch (e2e, compose)', () => {
  it('projects a restaurant so it is searchable by synonym, then rename, then delete', async () => {
    const suffix = randomUUID().slice(0, 8);
    const originalName = `Phở Hà Nội ${suffix}`;

    const createRes = await fetch(`${CATALOG_BASE_URL}/restaurants`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: originalName, description: 'Traditional beef noodle soup' }),
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const hit = await waitUntil(findById('pho', id));
    expect(hit.name).toBe(originalName);

    const suggestion = await waitUntil(async () => {
      const res = await fetch(`${SEARCH_BASE_URL}/search/restaurants/autocomplete?q=ph`, {
        headers: ownerHeaders,
      });
      if (res.status !== 200) {
        return undefined;
      }
      const suggestions = (await res.json()) as SearchHit[];
      return suggestions.find((s) => s.id === id);
    });
    expect(suggestion.name).toBe(originalName);

    const otherResult = await search('pho', otherTenantHeaders);
    expect(otherResult.data.find((h) => h.id === id)).toBeUndefined();

    const renamed = `Bún Chả ${suffix}`;
    const patchRes = await fetch(`${CATALOG_BASE_URL}/restaurants/${id}`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ name: renamed }),
    });
    expect(patchRes.status).toBe(200);
    const renamedHit = await waitUntil(findById('bun', id));
    expect(renamedHit.name).toBe(renamed);

    const deleteRes = await fetch(`${CATALOG_BASE_URL}/restaurants/${id}`, {
      method: 'DELETE',
      headers: ownerHeaders,
    });
    expect(deleteRes.status).toBe(204);
    await waitUntil(async () => {
      const gone = await findById('bun', id)();
      return gone === undefined ? true : undefined;
    });
  }, 120_000);
});
