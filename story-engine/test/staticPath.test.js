import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolvePublicPath } from '../lib/staticPath.js';

const PUBLIC = '/srv/app/public';

test('resolves normal public assets inside the root', () => {
  assert.equal(resolvePublicPath(PUBLIC, '/front_door.html'), join(PUBLIC, 'front_door.html'));
  assert.equal(resolvePublicPath(PUBLIC, '/css/site.css'), join(PUBLIC, 'css/site.css'));
});

test('blocks raw dot-segment traversal out of public/', () => {
  for (const p of ['/../.env', '/../package.json', '/../../CLAUDE.md', '/css/../../server.js', '/..']) {
    assert.equal(resolvePublicPath(PUBLIC, p), null, p);
  }
});

test('blocks sibling-prefix escape and null bytes', () => {
  assert.equal(resolvePublicPath(PUBLIC, '/../public-secrets/x.json'), null);
  assert.equal(resolvePublicPath(PUBLIC, '/a\0.html'), null);
});

test('dot segments that stay inside the root still resolve', () => {
  assert.equal(resolvePublicPath(PUBLIC, '/css/../front_door.html'), join(PUBLIC, 'front_door.html'));
});
