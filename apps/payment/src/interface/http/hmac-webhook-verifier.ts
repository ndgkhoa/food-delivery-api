import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header carrying the hex HMAC-SHA256 signature (optionally `sha256=` prefixed). */
export const WEBHOOK_SIGNATURE_HEADER = 'x-payment-signature';
/** Header carrying the unix-seconds timestamp the signature was computed over. */
export const WEBHOOK_TIMESTAMP_HEADER = 'x-payment-timestamp';

/** Default replay window: reject callbacks whose timestamp is older/newer than this. */
export const DEFAULT_WEBHOOK_TOLERANCE_SEC = 300;

export interface WebhookVerificationInput {
  secret: string;
  rawBody: string;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  /** Current unix time in seconds (injectable for deterministic tests). */
  nowSec?: number;
  toleranceSec?: number;
}

export type WebhookVerificationResult = { valid: true } | { valid: false; reason: string };

/** Signed payload binds the timestamp to the body so a captured body can't be replayed with a new time. */
function signedPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

function stripPrefix(signature: string): string {
  return signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
}

/** Constant-time hex compare that never throws on malformed/short input. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies an inbound provider webhook: recomputes HMAC-SHA256 over
 * `${timestamp}.${rawBody}` with the shared secret and constant-time compares it
 * to the signature header, then enforces a timestamp replay window. Fails closed
 * — any missing header, bad signature, or stale/skewed timestamp is rejected.
 */
export function verifyWebhookSignature(input: WebhookVerificationInput): WebhookVerificationResult {
  if (!input.signatureHeader) {
    return { valid: false, reason: 'missing signature header' };
  }
  if (!input.timestampHeader) {
    return { valid: false, reason: 'missing timestamp header' };
  }

  const timestamp = Number(input.timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'invalid timestamp header' };
  }

  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSec ?? DEFAULT_WEBHOOK_TOLERANCE_SEC;
  if (Math.abs(now - timestamp) > tolerance) {
    return { valid: false, reason: 'timestamp outside replay window' };
  }

  const expected = createHmac('sha256', input.secret)
    .update(signedPayload(input.timestampHeader, input.rawBody))
    .digest('hex');
  if (!safeEqualHex(expected, stripPrefix(input.signatureHeader))) {
    return { valid: false, reason: 'signature mismatch' };
  }

  return { valid: true };
}
