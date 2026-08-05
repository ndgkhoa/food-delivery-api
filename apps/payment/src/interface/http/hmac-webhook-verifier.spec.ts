import { createHmac } from 'node:crypto';
import {
  DEFAULT_WEBHOOK_TOLERANCE_SEC,
  verifyWebhookSignature,
} from '@payment/interface/http/hmac-webhook-verifier';

const SECRET = 'test-secret';
const NOW = 1_700_000_000;

function sign(rawBody: string, timestamp: number, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

describe('verifyWebhookSignature', () => {
  const rawBody = JSON.stringify({ orderId: 'o1', ok: true });

  it('accepts a correctly signed, fresh request', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: `sha256=${sign(rawBody, NOW)}`,
      timestampHeader: String(NOW),
      nowSec: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts a signature without the sha256= prefix', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: sign(rawBody, NOW),
      timestampHeader: String(NOW),
      nowSec: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a missing signature header', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: undefined,
      timestampHeader: String(NOW),
      nowSec: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'missing signature header' });
  });

  it('rejects a tampered body (signature mismatch)', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody: `${rawBody}tampered`,
      signatureHeader: `sha256=${sign(rawBody, NOW)}`,
      timestampHeader: String(NOW),
      nowSec: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'signature mismatch' });
  });

  it('rejects a wrong secret', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: `sha256=${sign(rawBody, NOW, 'other-secret')}`,
      timestampHeader: String(NOW),
      nowSec: NOW,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a stale timestamp outside the replay window', () => {
    const stale = NOW - DEFAULT_WEBHOOK_TOLERANCE_SEC - 1;
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: `sha256=${sign(rawBody, stale)}`,
      timestampHeader: String(stale),
      nowSec: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'timestamp outside replay window' });
  });

  it('rejects a missing timestamp header', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: `sha256=${sign(rawBody, NOW)}`,
      timestampHeader: undefined,
      nowSec: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'missing timestamp header' });
  });

  it('rejects a signature of a different length than expected (no timing-safe comparison possible)', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: 'sha256=abcd',
      timestampHeader: String(NOW),
      nowSec: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'signature mismatch' });
  });

  it('rejects an empty signature after stripping the prefix', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: 'sha256=',
      timestampHeader: String(NOW),
      nowSec: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'signature mismatch' });
  });

  it('rejects a non-numeric timestamp', () => {
    const result = verifyWebhookSignature({
      secret: SECRET,
      rawBody,
      signatureHeader: `sha256=${sign(rawBody, NOW)}`,
      timestampHeader: 'not-a-number',
      nowSec: NOW,
    });
    expect(result).toEqual({ valid: false, reason: 'invalid timestamp header' });
  });
});
