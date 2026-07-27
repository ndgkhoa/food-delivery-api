/** Configuration needed to offline-verify an access token against an IdP's JWKS. */
export interface AuthVerificationOptions {
  /** JWKS endpoint (e.g. Keycloak `.../protocol/openid-connect/certs`). */
  jwksUri: string;
  /** Expected `iss` claim — rejects tokens minted by any other issuer. */
  issuer: string;
  /** Expected `aud` claim — rejects tokens minted for any other audience. */
  audience: string;
  /** Leeway (seconds) for `exp`/`nbf` to tolerate minor clock skew. Defaults to 5. */
  clockToleranceSec?: number;
}
