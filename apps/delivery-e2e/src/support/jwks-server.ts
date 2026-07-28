import { createServer, type Server } from 'node:http';
import { createTestKeySet, type TestKeySet } from '@food-delivery-api/shared-jwt/testing';
import { JWKS_SERVER_PORT, JWT_AUDIENCE, JWT_ISSUER, KEYCLOAK_REALM } from './delivery-e2e-config';
import {
  FIXED_PRIVATE_KEY_PEM,
  FIXED_PUBLIC_KEY_PEM,
  FIXED_SIGNING_KID,
} from './fixed-signing-keys';

const CERTS_PATH = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`;

/**
 * ONE key set shared across every suite in the run. The delivery service caches
 * the JWKS it fetches (keyed by `kid`), so if each suite minted its own key pair
 * under the same default `kid`, only the first suite's tokens would verify and
 * the rest would fail the signature check. jest runs these serially in a single
 * worker without resetting the module registry, so this singleton is created
 * once and every suite serves + signs with the same keys.
 */
let sharedKeySet: Promise<TestKeySet> | undefined;
function sharedTestKeySet(): Promise<TestKeySet> {
  if (!sharedKeySet) {
    sharedKeySet = createTestKeySet({
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      kid: FIXED_SIGNING_KID,
      keyPair: { privateKeyPem: FIXED_PRIVATE_KEY_PEM, publicKeyPem: FIXED_PUBLIC_KEY_PEM },
    });
  }
  return sharedKeySet;
}

/**
 * Stands up a real RS256 JWKS the delivery service can fetch to verify WS
 * handshake tokens — no live Keycloak needed. The delivery service is started
 * (by the orchestrator) with `KEYCLOAK_URL=http://localhost:8899` so its derived
 * JWKS URI resolves to this server's certs endpoint. Tokens minted with `sign`
 * carry a real signature over this key set, so the service accepts them exactly
 * as it would a genuine Keycloak token.
 */
export class DeliveryJwksServer {
  private server?: Server;
  private keySet?: TestKeySet;

  async start(): Promise<void> {
    this.keySet = await sharedTestKeySet();
    const jwks = JSON.stringify(this.keySet.jwks);
    this.server = createServer((req, res) => {
      if (req.url === CERTS_PATH) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(jwks);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => this.server?.listen(JWKS_SERVER_PORT, resolve));
  }

  /** Mints a signed access token for a driver/customer with the given tenant + roles. */
  sign(params: { sub: string; tenantId: string; roles: string[] }): Promise<string> {
    if (!this.keySet) {
      throw new Error('DeliveryJwksServer.start() must run before sign()');
    }
    return this.keySet.sign(params);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server ? this.server.close((err) => (err ? reject(err) : resolve())) : resolve(),
    );
  }
}
