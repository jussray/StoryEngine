import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildContainerRuntimeEnv,
  CloudflareRuntimeConfigError
} from '../cloudflare/runtimeEnv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const storyEngineRoot = join(__dirname, '..');
const repoRoot = join(storyEngineRoot, '..');

function configErrorCode(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CloudflareRuntimeConfigError);
    return error.code;
  }
  assert.fail('expected CloudflareRuntimeConfigError');
}

test('Cloudflare runtime env fails closed until identity, auth, and durability are verified', () => {
  const sha = 'a'.repeat(40);
  const apiKeys = JSON.stringify({ creator: { role: 'creator' } });

  assert.equal(
    configErrorCode(() => buildContainerRuntimeEnv({
      L99_RELEASE_SHA: 'not-a-sha',
      L99_API_KEYS_JSON: apiKeys,
      L99_DURABLE_STATE_READY: 'verified'
    })),
    'release_identity_unconfigured'
  );

  assert.equal(
    configErrorCode(() => buildContainerRuntimeEnv({
      L99_RELEASE_SHA: sha,
      L99_DURABLE_STATE_READY: 'verified'
    })),
    'api_credentials_unconfigured'
  );

  assert.equal(
    configErrorCode(() => buildContainerRuntimeEnv({
      L99_RELEASE_SHA: sha,
      L99_API_KEYS_JSON: apiKeys
    })),
    'durable_state_unverified'
  );

  assert.deepEqual(
    buildContainerRuntimeEnv({
      L99_RELEASE_SHA: sha,
      L99_API_KEYS_JSON: apiKeys,
      L99_DURABLE_STATE_READY: 'verified'
    }),
    {
      NODE_ENV: 'production',
      PORT: '3000',
      L99_DB_PATH: '/data/l99.db',
      L99_RELEASE_SHA: sha,
      L99_API_KEYS_JSON: apiKeys
    }
  );
});

test('Wrangler contract owns one named StoryEngine container without taking route authority', () => {
  const config = JSON.parse(readFileSync(join(storyEngineRoot, 'wrangler.jsonc'), 'utf8'));

  assert.equal(config.name, 'storyengine');
  assert.equal(config.main, './cloudflare/worker.js');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.keep_vars, true);
  assert.equal(Object.hasOwn(config, 'route'), false);
  assert.equal(Object.hasOwn(config, 'routes'), false);

  assert.equal(config.containers.length, 1);
  assert.deepEqual(config.containers[0], {
    class_name: 'StoryEngineContainer',
    image: './Dockerfile',
    image_build_context: '.',
    max_instances: 1,
    instance_type: 'basic'
  });

  assert.deepEqual(config.durable_objects.bindings, [
    {
      name: 'STORYENGINE_CONTAINER',
      class_name: 'StoryEngineContainer'
    }
  ]);

  assert.ok(config.migrations.some(migration =>
    migration.new_sqlite_classes?.includes('StoryEngineContainer')
  ));
});

test('repo-root Wrangler invocation redirects to the canonical StoryEngine config', () => {
  const redirect = JSON.parse(readFileSync(join(repoRoot, '.wrangler/deploy/config.json'), 'utf8'));
  assert.deepEqual(redirect, {
    configPath: '../../story-engine/wrangler.jsonc'
  });
});

test('Cloudflare adapter preserves single-instance routing and fail-closed runtime validation', () => {
  const source = readFileSync(join(storyEngineRoot, 'cloudflare/worker.js'), 'utf8');

  assert.match(source, /idFromName\(PRIMARY_INSTANCE_NAME\)/);
  assert.match(source, /getTcpPort\(CONTAINER_PORT\)/);
  assert.match(source, /buildContainerRuntimeEnv\(this\.env\)/);
  assert.doesNotMatch(source, /@cloudflare\/containers/);
});
