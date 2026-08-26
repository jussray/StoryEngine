const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function runtimeIdentitySnapshot({ env = process.env, startedAt = Date.now() } = {}) {
  const production = env.NODE_ENV === 'production';
  const releaseSha = String(env.L99_RELEASE_SHA || '').trim();
  const configuredDbPath = String(env.L99_DB_PATH || '').trim();

  if (production && !GIT_SHA_PATTERN.test(releaseSha)) {
    throw new Error('Production requires L99_RELEASE_SHA bound to the exact 40-character Git commit SHA.');
  }

  if (production && !configuredDbPath) {
    throw new Error('Production requires L99_DB_PATH bound to a persistent mounted path.');
  }

  return Object.freeze({
    service: 'l99-story-engine',
    release_sha: releaseSha || 'development',
    runtime_mode: production ? 'production' : 'development',
    state_backend: 'sqlite',
    persistence_contract: production ? 'explicit-mounted-path' : 'repo-local',
    started_at: new Date(startedAt).toISOString()
  });
}
