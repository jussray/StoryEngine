import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIME_TYPES, contentTypeFor } from '../lib/mimeTypes.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

test('front-door hero image is served as image/jpeg, not text/plain', () => {
  // Regression: the hero JPEG was served with Content-Type text/plain.
  assert.equal(contentTypeFor(extname('/assets/front-door/hero-art.jpg')), 'image/jpeg');
});

test('raster image extensions map to image/* types', () => {
  assert.equal(contentTypeFor('.jpg'), 'image/jpeg');
  assert.equal(contentTypeFor('.jpeg'), 'image/jpeg');
  assert.equal(contentTypeFor('.png'), 'image/png');
  assert.equal(contentTypeFor('.webp'), 'image/webp');
  assert.equal(contentTypeFor('.gif'), 'image/gif');
});

test('existing web asset types are unchanged', () => {
  assert.equal(contentTypeFor('.html'), 'text/html');
  assert.equal(contentTypeFor('.js'), 'application/javascript');
  assert.equal(contentTypeFor('.css'), 'text/css');
  assert.equal(contentTypeFor('.json'), 'application/json');
  assert.equal(contentTypeFor('.ico'), 'image/x-icon');
});

test('unknown and prototype-key extensions fall back to text/plain', () => {
  assert.equal(contentTypeFor('.exe'), 'text/plain');
  assert.equal(contentTypeFor('.constructor'), 'text/plain');
  assert.equal(contentTypeFor('.__proto__'), 'text/plain');
});

test('SVG is not served as a document type', () => {
  assert.equal(MIME_TYPES['.svg'], undefined);
});

test('every file shipped under public/ has an explicit content type', () => {
  // Only .txt is allowed to use the text/plain fallback (llms.txt, robots.txt).
  const files = readdirSync(PUBLIC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath ?? entry.path}/${entry.name}`);
  assert.ok(files.length > 0, 'public/ should contain files');
  const unmapped = [...new Set(files.map((f) => extname(f).toLowerCase()))]
    .filter((ext) => !Object.hasOwn(MIME_TYPES, ext) && ext !== '.txt');
  assert.deepEqual(unmapped, [], `public/ extensions without a content type: ${unmapped.join(', ')}`);
});
