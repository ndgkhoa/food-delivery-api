/**
 * Minimal REST client for calling the gateway (`GATEWAY_URL`, e.g.
 * `http://localhost:3000/api/v1`) with a bearer token. Every non-2xx response
 * throws `ApiError` carrying the step description + status + raw response
 * body, so a failure mid-seed points straight at which call broke and why.
 */
export class ApiError extends Error {
  constructor(
    public readonly step: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`[${step}] gateway responded ${status}: ${body || '<empty body>'}`);
    this.name = 'ApiError';
  }
}

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private token: string,
  ) {}

  /** Swaps the bearer token used by subsequent calls (e.g. after logging in as a different seeded user). */
  setToken(token: string): void {
    this.token = token;
  }

  async request<T>(
    step: string,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new ApiError(step, response.status, text);
    }
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(step, response.status, `non-JSON response: ${text}`);
    }
  }
}

/** Formats any thrown error for a human-readable warning line (never throws itself). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
