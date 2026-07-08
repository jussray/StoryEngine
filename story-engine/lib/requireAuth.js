// lib/requireAuth.js

import { timingSafeEqual } from 'node:crypto';
import { json } from './miniRouter.js';

function configuredApiKey() {
  return String(process.env.API_KEY || '').trim();
}

function suppliedApiKey(req) {
  const direct = req.headers?.['x-api-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const authorization = req.headers?.authorization;
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

function secureEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireAuth(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const expected = configuredApiKey();
  if (!expected) {
    return json(res, 503, {
      error: 'api_auth_not_configured',
      message: 'Set API_KEY before serving API routes.'
    });
  }

  const supplied = suppliedApiKey(req);
  if (!supplied || !secureEquals(supplied, expected)) {
    return json(res, 401, { error: 'unauthorized' });
  }

  req.auth = { type: 'api_key' };
  return next();
}

export default requireAuth;
