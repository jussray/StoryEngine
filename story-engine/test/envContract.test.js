import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envExample = readFileSync(join(__dirname, '../.env.example'), 'utf8');
const securitySource = readFileSync(join(__dirname, '../lib/securityContext.js'), 'utf8');

test('production env contract advertises the scoped API key registry', () => {
  assert.match(envExample, /^L99_API_KEYS_JSON=/m);
  assert.match(envExample, /^ALLOW_LEGACY_API_KEY=false$/m);
});

test('runtime keeps the legacy API key behind an explicit production escape hatch', () => {
  assert.match(securitySource, /process\.env\.L99_API_KEYS_JSON/);
  assert.match(
    securitySource,
    /process\.env\.NODE_ENV !== 'production' \|\| process\.env\.ALLOW_LEGACY_API_KEY === 'true'/,
  );
});
