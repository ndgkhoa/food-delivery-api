export interface JwtVerificationOptions {
  jwksUri: string;
  issuer: string;
  audience: string;
  clockToleranceSec?: number;
}
