import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amazonBookUrl, buildWordPressBookDraft, wordpressConnection,
  createWordPressBookDraft, StorefrontError
} from '../lib/wordpressBookStorefront.js';
import wordpressStorefrontRoutes from '../routes/wordpressStorefront.js';

const artifact = {
  artifact_id: 'artifact-one', workspace_id: 'workspace-one', status: 'validated',
  content_hash: '012345abcdef', metadata: { medium: 'book' },
  validation: { passed: true, real_route_proof: true },
  html: '<p>Private manuscript text</p>'
};
const story = { title: 'Moon <script>', pitch: 'A novel & nice <b>story</b>' };
function build(options = {}) {
  return buildWordPressBookDraft({
    workspaceId: 'workspace-one', artifact, story, ...options
  });
}
test('WordPress storefront is always draft and never exposes full manuscript HTML', () => {
  const post = build({ amazonUrl: 'https://www.amazon.com/dp/B012345678?tag=tracking' });
  assert.equal(post.status, 'draft');
  assert.match(post.content, /Buy this book on Amazon/);
  assert.match(post.content, /&lt;script&gt;/);
  assert.doesNotMatch(post.content, /Private manuscript|<script>|<b>|tracking/);
  assert.equal(post.slug, build().slug);
});
test('prevents unvalidated, foreign-workspace, and wrong-medium artifacts', () => {
  for (const invalid of [
    { ...artifact, status: 'generated' }, { ...artifact, workspace_id: 'other-workspace' },
    { ...artifact, metadata: { medium: 'movie' } },
    { ...artifact, validation: { passed: true, real_route_proof: false } }
  ]) {
    assert.throws(() => build({ artifact: invalid }),
      error => error instanceof StorefrontError && error.status === 409);
  }
});
test('only canonical HTTPS Amazon product URLs are accepted', () => {
  assert.equal(amazonBookUrl('https://amazon.co.uk/Title/dp/1234567890?ref=ignored'),
    'https://amazon.co.uk/Title/dp/1234567890');
  for (const value of [
    'http://amazon.com/dp/B012345678', 'https://amazon.com.evil.test/dp/B012345678',
    'https://amazon.com/gp/cart', 'javascript:alert(1)',
    'https://amazon.com@evil.test/dp/B012345678'
  ]) assert.throws(() => amazonBookUrl(value), error => error.code === 'invalid_amazon_book_url');
});
test('WordPress requires HTTPS and server-side app credentials', () => {
  assert.throws(() => wordpressConnection({}), error => error.code === 'wordpress_not_configured');
  assert.throws(() => wordpressConnection({
    WORDPRESS_SITE_URL: 'http://localhost',
    WORDPRESS_APP_USERNAME: 'x', WORDPRESS_APP_PASSWORD: 'secret'
  }), error => error.code === 'wordpress_invalid_configuration');
  assert.equal(wordpressConnection({
    WORDPRESS_SITE_URL: 'https://books.example.org/blog/',
    WORDPRESS_APP_USERNAME: 'editor', WORDPRESS_APP_PASSWORD: 'secret'
  }).endpoint, 'https://books.example.org/blog/wp-json/wp/v2/posts');
});
test('WordPress adapter reads before writing and verifies draft readback', async () => {
  const draft = build();
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, ...init });
    const result = calls.length === 1 ? [] : calls.length === 2 ?
      { id: 52 } : { id: 52, slug: draft.slug, status: 'draft' };
    return { ok: true, json: async () => result };
  };
  const config = { endpoint: 'https://books.example.org/wp-json/wp/v2/posts',
    username: 'editor', password: 'secret' };
  const result = await createWordPressBookDraft(config, draft, fake);
  assert.equal(result.id, 52);
  assert.equal(result.status, 'draft');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].redirect, 'error');
  assert.equal(JSON.parse(calls[1].body).status, 'draft');
  const existing = await createWordPressBookDraft(config, draft, async () =>
    ({ ok: true, json: async () => [{ id: 52, slug: draft.slug, status: 'draft' }] }));
  assert.equal(existing.deduplicated, true);
});
test('provider uncertainty is reported without blind retries or success claims', async () => {
  let requests = 0;
  const config = { endpoint: 'https://books.example.org/wp-json/wp/v2/posts',
    username: 'editor', password: 'secret' };
  await assert.rejects(
    () => createWordPressBookDraft(config, build(), async () => {
      requests++; throw Error('request timed out');
    }),
    error => error.code === 'wordpress_outcome_unknown'
  );
  assert.equal(requests, 1);
});
test('route requires workspace scope, release manager and explicit confirmation before DB read', async () => {
  const posts = new Map();
  const db = new Proxy({}, { get() { throw Error('unauthorized database access'); } });
  wordpressStorefrontRoutes({ post: (url, handler) => posts.set(url, handler) }, db);
  const handler = posts.get('/api/workspaces/:workspace_id/wordpress/book-draft');
  const response = () => ({
    writableEnded: false,
    writeHead(status) { this.status = status; },
    end(value) { this.body = JSON.parse(value); this.writableEnded = true; }
  });
  const cases = [
    [{ role: 'release_manager', workspace_ids: ['other'], tenant_id: 't', actor_id: 'a' },
      { confirm_draft: true }, 403],
    [{ role: 'creator', workspace_ids: ['workspace-one'], tenant_id: 't', actor_id: 'a' },
      { confirm_draft: true }, 403],
    [{ role: 'release_manager', workspace_ids: ['workspace-one'], tenant_id: 't', actor_id: 'a' },
      {}, 400]
  ];
  for (const [auth, body, expected] of cases) {
    const res = response();
    await handler({ auth, body, params: { workspace_id: 'workspace-one' } }, res);
    assert.equal(res.status, expected);
  }
});
