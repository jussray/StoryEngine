import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('every public browser script parses as classic JavaScript', () => {
  const scripts = readdirSync(publicDir).filter(name => name.endsWith('.js'));
  assert.ok(scripts.includes('story_images.js'), 'story_images.js must be covered by this check');
  for (const name of scripts) {
    const source = readFileSync(join(publicDir, name), 'utf8');
    assert.doesNotThrow(() => new Script(source, { filename: name }), name);
  }
});
