// staticPath.js — contain static file requests inside the public directory.
// Raw req.url is not normalized by node:http, so "/../x" would otherwise
// escape public/ via path.join. Returns null for anything outside the root.

import { resolve, sep } from 'node:path';

export function resolvePublicPath(publicDir, urlPath) {
  if (typeof urlPath !== 'string' || urlPath.includes('\0')) return null;
  const root = resolve(publicDir);
  const target = resolve(root, '.' + (urlPath.startsWith('/') ? urlPath : '/' + urlPath));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}
