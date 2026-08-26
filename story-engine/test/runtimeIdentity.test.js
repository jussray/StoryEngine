import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeIdentitySnapshot } from '../lib/runtimeIdentity.js';

const RELEASE_SHA = 'd00861810b3963f1cb4329a71e1f049bfdaf1565';

test('development identity remains explicit without production bindings', () => {
  const identity = runtimeIdentitySnapshot({
    env: { NODE_ENV: 'test' },
    startedAt: 0
  });

  assert.deepEqual(identity, {
    service: 'l99-story-engine',
    release_sha: 'development',
    runtime_mode: 'development',
    state_backend: 'sqlite',
    persistence_contract: 'repo-local',
    started_at: '1970-01-01T00:00:00.000Z'
  });
});

test('production identity requires an exact Git SHA', () => {
  assert.throws(
    () => runtimeIdentitySnapshot({
      env: {
        NODE_ENV: 'production',
        L99_DB_PATH: '/data/l99.db',
        L99_RELEASE_SHA: 'not-a-sha'
      }
    }),
    /L99_RELEASE_SHA/
  );
});

test('production identity requires an explicit persistent database path', () => {
  assert.throws(
    () => runtimeIdentitySnapshot({
      env: {
        NODE_ENV: 'production',
        L99_RELEASE_SHA: RELEASE_SHA
      }
    }),
    /L99_DB_PATH/
  );
});

test('production identity binds state and release truth', () => {
  const identity = runtimeIdentitySnapshot({
    env: {
      NODE_ENV: 'production',
      L99_RELEASE_SHA: RELEASE_SHA,
      L99_DB_PATH: '/data/l99.db'
    },
    startedAt: 0
  });

  assert.equal(identity.release_sha, RELEASE_SHA);
  assert.equal(identity.runtime_mode, 'production');
  assert.equal(identity.state_backend, 'sqlite');
  assert.equal(identity.persistence_contract, 'explicit-mounted-path');
});
