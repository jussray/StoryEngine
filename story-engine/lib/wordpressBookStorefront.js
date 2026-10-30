import { createHash } from 'node:crypto';

// Draft-only WordPress storefront. This module never publishes to WordPress or Amazon KDP.
export class StorefrontError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function amazonBookUrl(value) {
  if (value == null || value === '') return null;
  let url;
  try { url = new URL(String(value)); }
  catch { throw new StorefrontError('invalid_amazon_book_url'); }
  const market = /^(?:www\.)?amazon\.(?:com|ca|co\.uk|de|fr|it|es|in|com\.au|co\.jp|com\.br|com\.mx|nl|se|pl)$/i;
  const product = /\/(?:dp|gp\/product)\/[a-z0-9]{10}(?:\/|$)/i;
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !market.test(url.hostname) || !product.test(url.pathname)) {
    throw new StorefrontError('invalid_amazon_book_url');
  }
  return url.origin + url.pathname;
}

export function buildWordPressBookDraft({ workspaceId, artifact, story, amazonUrl }) {
  if (!artifact || artifact.workspace_id !== workspaceId || artifact.status !== 'validated' ||
    artifact.validation?.passed !== true || artifact.validation?.real_route_proof !== true) {
    throw new StorefrontError('validated_artifact_required', 409);
  }
  if (!['book', 'picture_book'].includes(artifact.metadata?.medium)) {
    throw new StorefrontError('book_artifact_required', 409);
  }
  if (!story || !String(story.title || '').trim()) throw new StorefrontError('story_title_required', 409);
  const url = amazonBookUrl(amazonUrl);
  const title = String(story.title).trim().slice(0, 180);
  const summary = String(story.pitch || '').trim().slice(0, 650);
  const hash = createHash('sha256').update(workspaceId + ':' + artifact.content_hash)
    .digest('hex').slice(0, 20);
  const content = '<h2>' + escapeHtml(title) + '</h2>\n<p>' +
    escapeHtml(summary || 'Book details and availability coming soon.') + '</p>' +
    (url ? '\n<p><a href="' + escapeHtml(url) +
      '" rel="noopener noreferrer">Buy this book on Amazon</a></p>' :
      '\n<p>Amazon purchase link will be added after the book is listed.</p>');
  return {
    slug: 'storyengine-book-' + hash, title, content, excerpt: summary || '',
    status: 'draft', comment_status: 'closed', ping_status: 'closed'
  };
}

export function wordpressConnection(env = process.env) {
  const site = String(env.WORDPRESS_SITE_URL || '').trim();
  const username = String(env.WORDPRESS_APP_USERNAME || '').trim();
  const password = String(env.WORDPRESS_APP_PASSWORD || '').trim();
  if (!site || !username || !password) throw new StorefrontError('wordpress_not_configured', 503);
  let url;
  try { url = new URL(site); }
  catch { throw new StorefrontError('wordpress_invalid_configuration', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search ||
    url.hash || url.port || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new StorefrontError('wordpress_invalid_configuration', 503);
  }
  const base = url.origin + url.pathname.replace(/\/$/, '');
  return { endpoint: base + '/wp-json/wp/v2/posts', username, password };
}

export async function createWordPressBookDraft(config, draft, fetchImpl = fetch) {
  const auth = 'Basic ' + Buffer.from(config.username + ':' + config.password).toString('base64');
  async function call(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        headers: { Authorization: auth, Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
        redirect: 'error', signal: AbortSignal.timeout(8000)
      });
    } catch { throw new StorefrontError('wordpress_outcome_unknown', 502); }
    if (!response.ok) throw new StorefrontError('wordpress_provider_rejected', 502);
    try { return await response.json(); }
    catch { throw new StorefrontError('wordpress_outcome_unknown', 502); }
  }

  // Reconcile by deterministic slug; never blind-retry after an unknown write.
  const query = config.endpoint + '?context=edit&status=any&slug=' +
    encodeURIComponent(draft.slug) + '&per_page=10';
  const candidates = await call(query);
  if (!Array.isArray(candidates)) throw new StorefrontError('wordpress_invalid_response', 502);
  const existing = candidates.find(item => item.slug === draft.slug);
  if (existing) {
    if (existing.status !== 'draft') throw new StorefrontError('wordpress_existing_post_not_draft', 409);
    return { id: existing.id, status: 'draft', link: existing.link || null, deduplicated: true };
  }
  const created = await call(config.endpoint, { method: 'POST', body: JSON.stringify(draft) });
  if (!Number.isSafeInteger(created?.id) || created.id < 1)
    throw new StorefrontError('wordpress_outcome_unknown', 502);
  const readback = await call(config.endpoint + '/' + created.id + '?context=edit');
  if (readback.id !== created.id || readback.slug !== draft.slug || readback.status !== 'draft') {
    throw new StorefrontError('wordpress_outcome_unknown', 502);
  }
  return { id: readback.id, status: 'draft', link: readback.link || null, deduplicated: false };
}
