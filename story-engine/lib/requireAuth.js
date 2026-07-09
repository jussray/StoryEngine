// lib/requireAuth.js
// Backward-compatible export. New code should import from securityContext.js.

export { requireAuth as default, requireAuth } from './securityContext.js';
