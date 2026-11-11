/** Server-only Supabase companion telemetry transport. Never use in browser code. */
const REF = /^[a-z0-9]{20}$/;

export function resolveSupabaseCompanionTarget(env = process.env) {
  const url = String(env.SUPABASE_URL ?? '').trim();
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const ref = String(env.STORYENGINE_SUPABASE_PROJECT_REF ?? '').trim();

  if (!url && !key && !ref) return null;
  if (!url || !key || !ref) {
    throw new Error('StoryEngine Supabase companion transport is incompletely configured');
  }
  if (!REF.test(ref)) {
    throw new Error('Invalid StoryEngine Supabase project reference');
  }
  const origin = `https://${ref}.supabase.co`;
  if (url !== origin && url !== `${origin}/`) {
    throw new Error('StoryEngine Supabase URL does not match the authorized project reference');
  }
  if (key.startsWith('sb_publishable_')) {
    throw new Error('StoryEngine companion telemetry requires a server-side secret');
  }
  return { endpoint: `${origin}/rest/v1/companion_requests`, key };
}

export async function appendSupabaseCompanionRequest(row, {
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const target = resolveSupabaseCompanionTarget(env);
  if (!target) return false;

  const headers = {
    apikey: target.key,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  if (!target.key.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${target.key}`;
  }

  const response = await fetchImpl(target.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    // Never include a provider error body, URL, payload, or key in logs.
    throw new Error(`StoryEngine Supabase companion insert returned HTTP ${response.status}`);
  }
  return true;
}
