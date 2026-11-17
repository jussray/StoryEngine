// mimeTypes.js — Content-Type for files served from public/.
// A missing entry makes server.js declare text/plain for the file, so an image
// is labelled with a non-image type (wrong header; headless Chromium still
// rendered the hero JPEG, so this is a correctness fix, not a reproduced outage).
// Every extension shipped under public/ must have an entry (see test/mimeTypes.test.js).
// SVG is intentionally absent: served as a document it can carry script, and no
// public SVG exists today. Add it only with an explicit sanitization decision.

export const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

export function contentTypeFor(ext) {
  return Object.hasOwn(MIME_TYPES, ext) ? MIME_TYPES[ext] : 'text/plain';
}
