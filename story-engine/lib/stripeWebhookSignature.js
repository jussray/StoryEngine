import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;

function parseTolerance(value) {
  const parsed = Number(value ?? DEFAULT_TOLERANCE_SECONDS);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TOLERANCE_SECONDS;
  return Math.min(Math.floor(parsed), 3600);
}

function safeHexEqual(leftHex, rightHex) {
  if (!/^[0-9a-f]+$/i.test(String(leftHex || '')) || !/^[0-9a-f]+$/i.test(String(rightHex || ''))) return false;
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyStripeWebhookSignature({ rawBody, signatureHeader, secret, nowMs = Date.now(), toleranceSeconds } = {}) {
  const endpointSecret = String(secret || '').trim();
  if (!endpointSecret) return { verified: false, reason: 'secret_not_configured' };
  if (!Buffer.isBuffer(rawBody)) return { verified: false, reason: 'raw_body_missing' };

  const header = String(signatureHeader || '').trim();
  if (!header) return { verified: false, reason: 'signature_missing' };

  const values = header.split(',').map(part => part.trim()).filter(Boolean);
  const timestampPart = values.find(part => part.startsWith('t='));
  const signatures = values.filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  const timestamp = Number(timestampPart?.slice(2));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || signatures.length === 0) {
    return { verified: false, reason: 'signature_malformed' };
  }

  const tolerance = parseTolerance(toleranceSeconds ?? process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS);
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestamp);
  if (ageSeconds > tolerance) return { verified: false, reason: 'signature_timestamp_outside_tolerance' };

  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    rawBody
  ]);
  const expected = createHmac('sha256', endpointSecret).update(signedPayload).digest('hex');
  const verified = signatures.some(signature => safeHexEqual(signature, expected));
  return verified
    ? { verified: true, timestamp, tolerance_seconds: tolerance }
    : { verified: false, reason: 'signature_mismatch' };
}
