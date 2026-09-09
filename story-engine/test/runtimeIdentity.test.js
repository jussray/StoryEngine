import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePersistenceWitness, runtimeIdentitySnapshot } from '../lib/runtimeIdentity.js';

const RELEASE_SHA = 'd00861810b3963f1cb4329a71e1f049bfdaf1565';
const OTHER_RELEASE_SHA = '608341a8bdfd662d5a0140e84e3b294ec982d16c';
const WITNESS_ID = '123e4567-e89b-42d3-a456-426614174000';

test('development identity remains explicit without production bindings', () => {
  const identity = runtimeIdentitySnapshot({
    env: { NODE_ENV: 'test' },
    startedAt: 0
  });

  assert.deepEqual(identity, {
    service: 'l99-story-engine',
    release_sha: 'development',
    release_sha_source: 'development',
    configured_release_sha_matches: null,
    runtime_mode: 'development',
    state_backend: 'sqlite',
    persistence_contract: 'repo-local',
    persistence_witness: null,
    started_at: '1970-01-01T00:00:00.000Z'
  });
});

test('production identity requires an exact Git SHA when Railway metadata is absent', () => {
  assert.throws(
    () => runtimeIdentitySnapshot({
      env: {
        NODE_ENV: 'production',
        L99_DB_PATH: '/data/l99.db',
        L99_RELEASE_SHA: 'not-a-sha'
      },
      persistenceWitnessId: WITNESS_ID
    }),
    /RAILWAY_GIT_COMMIT_SHA|L99_RELEASE_SHA/
  );
});

test('production identity rejects malformed Railway-native release metadata', () => {
  assert.throws(
    () => runtimeIdentitySnapshot({
      env: {
        NODE_ENV: 'production',
        RAILWAY_GIT_COMMIT_SHA: 'not-a-sha',
        L99_RELEASE_SHA: RELEASE_SHA,
        L99_DB_PATH: '/data/l99.db'
      },
      persistenceWitnessId: WITNESS_ID
    }),
    /RAILWAY_GIT_COMMIT_SHA/
  );
});

test('production identity prefers Railway-native commit truth over a stale configured label', () => {
  const identity = runtimeIdentitySnapshot({
    env: {
      NODE_ENV: 'production',
      RAILWAY_GIT_COMMIT_SHA: RELEASE_SHA,
      L99_RELEASE_SHA: OTHER_RELEASE_SHA,
      L99_DB_PATH: '/data/l99.db'
    },
    persistenceWitnessId: WITNESS_ID,
    startedAt: 0
  });

  assert.equal(identity.release_sha, RELEASE_SHA);
  assert.equal(identity.release_sha_source, 'railway-git');
  assert.equal(identity.configured_release_sha_matches, false);
});

test('production identity requires an explicit persistent database path', () => {
  assert.throws(
    () => runtimeIdentitySnapshot({
      env: {
        NODE_ENV: 'production',
        RAILWAY_GIT_COMMIT_SHA: RELEASE_SHA
      },
      persistenceWitnessId: WITNESS_ID
    }),
    /L99_DB_PATH/
  );
});

test('production identity requires a valid durable persistence witness', () => {
  assert.throws(
    () => runtimeIdentitySnapshot({
      env: {
        NODE_ENV: 'production',
        RAILWAY_GIT_COMMIT_SHA: RELEASE_SHA,
        L99_DB_PATH: '/data/l99.db'
      },
      persistenceWitnessId: 'not-a-witness'
    }),
    /persistence witness/
  );
});

test('production identity binds state, Railway release, and persistence continuity truth', () => {
  const identity = runtimeIdentitySnapshot({
    env: {
      NODE_ENV: 'production',
      RAILWAY_GIT_COMMIT_SHA: RELEASE_SHA,
      L99_RELEASE_SHA: RELEASE_SHA,
      L99_DB_PATH: '/data/l99.db'
    },
    persistenceWitnessId: WITNESS_ID,
    startedAt: 0
  });

  assert.equal(identity.release_sha, RELEASE_SHA);
  assert.equal(identity.release_sha_source, 'railway-git');
  assert.equal(identity.configured_release_sha_matches, true);
  assert.equal(identity.runtime_mode, 'production');
  assert.equal(identity.state_backend, 'sqlite');
  assert.equal(identity.persistence_contract, 'explicit-mounted-path');
  assert.equal(identity.persistence_witness, WITNESS_ID);
});

test('production identity can fall back to configured release truth outside a Railway GitHub deploy', () => {
  const identity = runtimeIdentitySnapshot({
    env: {
      NODE_ENV: 'production',
      L99_RELEASE_SHA: RELEASE_SHA,
      L99_DB_PATH: '/data/l99.db'
    },
    persistenceWitnessId: WITNESS_ID,
    startedAt: 0
  });

  assert.equal(identity.release_sha, RELEASE_SHA);
  assert.equal(identity.release_sha_source, 'configured');
  assert.equal(identity.configured_release_sha_matches, null);
});

test('persistence witness is created once and survives subsequent runtime starts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'storyengine-witness-'));
  const dbPath = join(directory, 'l99.db');
  try {
    const first = ensurePersistenceWitness(dbPath);
    const second = ensurePersistenceWitness(dbPath);
    assert.match(first, /^[0-9a-f-]{36}$/i);
    assert.equal(second, first);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
