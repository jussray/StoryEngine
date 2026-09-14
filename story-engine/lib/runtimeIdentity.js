import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSISTENCE_WITNESS_FILE = '.storyengine-persistence-witness';

export function ensurePersistenceWitness(dbPath) {
  const configuredDbPath = String(dbPath || '').trim();
  if (!configuredDbPath) {
    throw new Error('A database path is required to establish the persistence witness.');
  }

  const directory = dirname(resolve(configuredDbPath));
  const witnessPath = join(directory, PERSISTENCE_WITNESS_FILE);
  mkdirSync(directory, { recursive: true });

  try {
    const fd = openSync(witnessPath, 'wx', 0o600);
    try {
      writeFileSync(fd, `${randomUUID()}\n`, { encoding: 'utf8' });
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  const witnessId = readFileSync(witnessPath, 'utf8').trim();
  if (!UUID_PATTERN.test(witnessId)) {
    throw new Error('Persistent storage witness is missing or invalid.');
  }
  return witnessId;
}

export function runtimeIdentitySnapshot({
  env = process.env,
  startedAt = Date.now(),
  persistenceWitnessId = null
} = {}) {
  const production = env.NODE_ENV === 'production';
  const configuredReleaseSha = String(env.L99_RELEASE_SHA || '').trim();
  const railwayReleaseSha = String(env.RAILWAY_GIT_COMMIT_SHA || '').trim();
  const configuredDbPath = String(env.L99_DB_PATH || '').trim();

  if (production && railwayReleaseSha && !GIT_SHA_PATTERN.test(railwayReleaseSha)) {
    throw new Error('Production RAILWAY_GIT_COMMIT_SHA must be an exact 40-character Git commit SHA.');
  }

  if (production && !railwayReleaseSha && !GIT_SHA_PATTERN.test(configuredReleaseSha)) {
    throw new Error(
      'Production requires RAILWAY_GIT_COMMIT_SHA or fallback L99_RELEASE_SHA bound to the exact 40-character Git commit SHA.'
    );
  }

  if (production && !configuredDbPath) {
    throw new Error('Production requires L99_DB_PATH bound to a persistent mounted path.');
  }

  const releaseSha = railwayReleaseSha || configuredReleaseSha;
  const releaseShaSource = production
    ? (railwayReleaseSha ? 'railway-git' : 'configured')
    : 'development';
  const configuredReleaseShaMatches = production && railwayReleaseSha && configuredReleaseSha
    ? configuredReleaseSha.toLowerCase() === railwayReleaseSha.toLowerCase()
    : null;

  const witnessId = production
    ? String(persistenceWitnessId || ensurePersistenceWitness(configuredDbPath)).trim()
    : '';

  if (production && !UUID_PATTERN.test(witnessId)) {
    throw new Error('Production requires a durable storage persistence witness.');
  }

  return Object.freeze({
    service: 'l99-story-engine',
    release_sha: releaseSha || 'development',
    release_sha_source: releaseShaSource,
    configured_release_sha_matches: configuredReleaseShaMatches,
    runtime_mode: production ? 'production' : 'development',
    state_backend: 'sqlite',
    persistence_contract: production ? 'explicit-mounted-path' : 'repo-local',
    persistence_witness: production ? witnessId : null,
    started_at: new Date(startedAt).toISOString()
  });
}
