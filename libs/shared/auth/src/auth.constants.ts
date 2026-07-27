/** DI token for the verifier options (JWKS URI, issuer, audience). */
export const AUTH_VERIFICATION_OPTIONS = Symbol('AuthVerificationOptions');

/**
 * DI token for the JWKS key resolver. Bound to a remote (Keycloak) JWKS set in
 * production; overridden in tests with a static/local JWK set so no live IdP is
 * needed. Kept as a separate token precisely so tests can inject test keys.
 */
export const JWKS_KEY_RESOLVER = Symbol('JwksKeyResolver');
