const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export class CloudflareRuntimeConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CloudflareRuntimeConfigError';
    this.code = code;
  }
}

function requiredString(env, key) {
  return String(env?.[key] ?? '').trim();
}

export function buildContainerRuntimeEnv(env = {}) {
  const releaseSha = requiredString(env, 'L99_RELEASE_SHA');
  if (!GIT_SHA_PATTERN.test(releaseSha)) {
    throw new CloudflareRuntimeConfigError(
      'release_identity_unconfigured',
      'Cloudflare runtime requires L99_RELEASE_SHA bound to the exact 40-character Git commit SHA.'
    );
  }

  const apiKeysJson = requiredString(env, 'L99_API_KEYS_JSON');
  if (!apiKeysJson) {
    throw new CloudflareRuntimeConfigError(
      'api_credentials_unconfigured',
      'Cloudflare runtime requires L99_API_KEYS_JSON as a server-side runtime secret.'
    );
  }

  const durabilityState = requiredString(env, 'L99_DURABLE_STATE_READY');
  if (durabilityState !== 'verified') {
    throw new CloudflareRuntimeConfigError(
      'durable_state_unverified',
      'Cloudflare runtime will not start until durable StoryEngine state has been verified.'
    );
  }

  return Object.freeze({
    NODE_ENV: 'production',
    PORT: '3000',
    L99_DB_PATH: '/data/l99.db',
    L99_RELEASE_SHA: releaseSha,
    L99_API_KEYS_JSON: apiKeysJson
  });
}
