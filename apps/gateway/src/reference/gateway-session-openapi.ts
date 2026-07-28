/**
 * Minimal OpenAPI document for the gateway's OWN public session endpoints
 * (Keycloak OIDC token exchange / refresh / logout). These live on the gateway,
 * not a downstream service, so they aren't in any service's auto-generated spec
 * — this hand-written doc makes them show up in the aggregated reference too.
 * Hand-written (not SwaggerModule) so the `@All('*path')` reverse-proxy routes
 * don't leak into the docs as noise.
 */
const jsonBody = (...required: string[]) => ({
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required,
        properties: Object.fromEntries(required.map((name) => [name, { type: 'string' }])),
      },
    },
  },
});

export const gatewaySessionOpenApi = {
  openapi: '3.0.0',
  info: {
    title: 'Gateway Session API',
    version: '1.0',
    description: 'Public session endpoints at the gateway edge (Keycloak OIDC).',
  },
  paths: {
    '/api/v1/auth/token': {
      post: {
        tags: ['session'],
        summary: 'Exchange an authorization code (PKCE) for a token set',
        requestBody: jsonBody('code', 'codeVerifier', 'redirectUri'),
        responses: { '200': { description: 'Access + refresh token set' } },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['session'],
        summary: 'Rotate a refresh token for a fresh token set',
        requestBody: jsonBody('refreshToken'),
        responses: { '200': { description: 'New token set' } },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['session'],
        summary: 'Revoke the refresh token and end the Keycloak session',
        requestBody: jsonBody('refreshToken'),
        responses: { '204': { description: 'Logged out' } },
      },
    },
  },
} as const;
