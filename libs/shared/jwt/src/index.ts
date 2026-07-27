export { AccessTokenVerifier, verifyAccessToken } from './access-token-verifier';
export { extractIdentity, MissingIdentityClaimError, type VerifiedIdentity } from './identity';
export { createRemoteJwksResolver, type JwksKeyResolver } from './jwks-resolver';
export { JWKS_KEY_RESOLVER, JWT_VERIFICATION_OPTIONS } from './jwt-verification.constants';
export { JwtVerificationModule } from './jwt-verification.module';
export type { JwtVerificationOptions } from './jwt-verification-options';
