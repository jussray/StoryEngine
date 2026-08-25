import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const authClient = readFileSync(new URL('../public/l99_auth.js', import.meta.url), 'utf8');
const streamClients = [
  '../public/control_room.js',
  '../public/ooda_dashboard.js',
  '../public/performance_dashboard.js'
].map(path => [path, readFileSync(new URL(path, import.meta.url), 'utf8')]);

test('browser auth helper provides a fetch-backed SSE client', () => {
  assert.match(authClient, /authenticatedEventStream/);
  assert.match(authClient, /Accept['"]?\s*:\s*['"]text\/event-stream/);
  assert.match(authClient, /headers\.set\('x-api-key', key\)/);
  assert.doesNotMatch(authClient, /new EventSource/);
});

test('authenticated dashboards do not open raw EventSource connections to protected API streams', () => {
  for (const [path, source] of streamClients) {
    assert.doesNotMatch(source, /new EventSource\('/, `${path} must use authenticatedEventStream so x-api-key is sent`);
    assert.match(source, /window\.L99\.authenticatedEventStream\('/, `${path} must use the shared authenticated stream helper`);
  }
});
