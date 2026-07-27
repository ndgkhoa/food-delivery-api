export { AccessTokenVerifier, verifyAccessToken } from './access-token-verifier';
export { AUTH_VERIFICATION_OPTIONS, JWKS_KEY_RESOLVER } from './auth.constants';
export { SharedAuthModule } from './auth.module';
export type { AuthVerificationOptions } from './auth-options';
export { extractIdentity, MissingIdentityClaimError, type VerifiedIdentity } from './identity';
export { createRemoteJwksResolver, type JwksKeyResolver } from './jwks-resolver';
