// lib/securityContext.js

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { json } from './miniRouter.js';

const ROLE_ORDER = Object.freeze({ viewer: 10, creator: 20, editor: 30, reviewer: 40, release_manager: 50, administrator: 60 });

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseKeyRegistry() {
  const raw = String(process.env.L99_API_KEYS_JSON || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('L99_API_KEYS_JSON must be a JSON array.');
    return parsed.map(item => ({
      key: String(item.key || '').trim(),
      actor_id: String(item.actor_id || item.user_id || '').trim(),
      tenant_id: String(item.tenant_id || '').trim(),
      role: String(item.role || 'viewer').trim(),
      workspace_ids: Array.isArray(item.workspace_ids) ? item.workspace_ids.map(String) : ['*']
    })).filter(item => item.key && item.actor_id && item.tenant_id && ROLE_ORDER[item.role]);
  } catch (error) {
    throw new Error(`Invalid L99_API_KEYS_JSON: ${error.message}`);
  }
}

function suppliedCredential(req) {
  const direct = req.headers?.['x-api-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const authorization = req.headers?.authorization;
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

function legacyIdentity(key) {
  const configured = String(process.env.API_KEY || '').trim();
  const allowLegacy = process.env.NODE_ENV !== 'production' || process.env.ALLOW_LEGACY_API_KEY === 'true';
  if (!allowLegacy || !configured || !safeEqual(key, configured)) return null;
  return {
    type: 'legacy_api_key',
    actor_id: 'legacy-founder',
    tenant_id: 'founder',
    role: 'administrator',
    workspace_ids: ['*']
  };
}

function resolveIdentity(key) {
  const registry = parseKeyRegistry();
  for (const item of registry) {
    if (safeEqual(key, item.key)) return { type: 'scoped_api_key', ...item, key: undefined };
  }
  return legacyIdentity(key);
}

export function requestContext(req, res, next) {
  const requestId = String(req.headers?.['x-request-id'] || randomUUID());
  req.request_id = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; font-src 'self' https://fonts.gstatic.com https://cdn.fontshare.com; script-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data:; connect-src 'self'");
  return next();
}

export function requireAuth(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  const supplied = suppliedCredential(req);
  if (!supplied) return json(res, 401, { error: 'unauthorized', request_id: req.request_id });

  let identity;
  try {
    identity = resolveIdentity(supplied);
  } catch (error) {
    return json(res, 503, { error: 'auth_registry_invalid', message: error.message, request_id: req.request_id });
  }
  if (!identity) return json(res, 401, { error: 'unauthorized', request_id: req.request_id });

  req.auth = identity;
  return next();
}

export function requireRole(...allowedRoles) {
  const minimum = Math.min(...allowedRoles.map(role => ROLE_ORDER[role] || Infinity));
  return (req, res, next) => {
    const score = ROLE_ORDER[req.auth?.role] || 0;
    if (score < minimum) {
      return json(res, 403, { error: 'forbidden', required_roles: allowedRoles, actor_role: req.auth?.role || null, request_id: req.request_id });
    }
    return next();
  };
}

export function enforceWorkspaceAccess(req, res, next) {
  const workspaceId = req.params?.workspace_id || req.body?.workspace_id || null;
  if (!workspaceId) return next();
  const allowed = req.auth?.workspace_ids || [];
  if (allowed.includes('*') || allowed.includes(String(workspaceId))) return next();
  return json(res, 403, { error: 'workspace_forbidden', workspace_id: workspaceId, request_id: req.request_id });
}

export function authSnapshot(req) {
  return {
    actor_id: req.auth?.actor_id || null,
    tenant_id: req.auth?.tenant_id || null,
    role: req.auth?.role || null,
    auth_type: req.auth?.type || null,
    request_id: req.request_id || null
  };
}
