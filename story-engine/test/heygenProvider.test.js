import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRouter } from '../lib/miniRouter.js';
import { PassThrough } from 'node:stream';
import videoEngineRoutes from '../routes/videoEngine.js';
import { createContinuityCookie } from '../lib/videoContinuity.js';
import { createStoryVideoJob, getStoryVideoJob } from '../lib/videoEngine.js';
import {
  ensureHeygenSchema, getHeygenAttempt, heygenReadiness,
  submitHeygenShot, refreshHeygenShot
} from '../lib/heygenProvider.js';

const env = Object.freeze({
  HEYGEN_API_KEY: 'test-key-not-real',
  HEYGEN_SUBMISSIONS_ENABLED: 'true'
});

function job(overrides = {}) {
  return {
    job_id: 'video_job_test', workspace_id: 'workspace_one', source_revision_id: 'revision_one',
    status: 'preview_validated', validation: { passed: true },
    blueprint: {
      workspace_id: 'workspace_one',
      source_revision_id: 'revision_one',
      aspect_ratio: '9:16',
      shots: [{
        shot_id: 'shot_01', narration: 'The story continues with a new beginning.',
        provider_prompt: 'a human speaks'
      }]
    },
    ...overrides
  };
}

function input(j = job()) {
  return {
    shot_id: 'shot_01', avatar_id: 'avatar_123', voice_id: 'voice_123',
    approve_provider_spend: true,
    continuity_cookie: createContinuityCookie(j).value
  };
}

function mockResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

test('HeyGen is disabled by default and never exposes an API key through readiness', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    assert.deepEqual(heygenReadiness({}).ready, false);
    assert.equal(JSON.stringify(heygenReadiness(env)).includes(env.HEYGEN_API_KEY), false);
    await assert.rejects(
      submitHeygenShot(db, job(), input(), { env: { HEYGEN_API_KEY: env.HEYGEN_API_KEY } }),
      { code: 'HEYGEN_DISABLED' }
    );
    await assert.rejects(
      submitHeygenShot(db, job(), { ...input(), approve_provider_spend: false }, { env }),
      { code: 'HEYGEN_APPROVAL_REQUIRED' }
    );
  } finally { db.close(); }
});

test('HeyGen refuses paid submission when the production switch is explicitly false', async () => {
  const db = new DatabaseSync(':memory:');
  let providerCalls = 0;
  try {
    const disabledEnv = { ...env, HEYGEN_SUBMISSIONS_ENABLED: 'false' };
    assert.equal(heygenReadiness(disabledEnv).configured, true);
    assert.equal(heygenReadiness(disabledEnv).ready, false);
    await assert.rejects(
      submitHeygenShot(db, job(), input(), {
        env: disabledEnv,
        fetchImpl: async () => {
          providerCalls += 1;
          throw new Error('Disabled HeyGen must never reach the paid provider');
        }
      }),
      { code: 'HEYGEN_DISABLED' }
    );
    assert.equal(providerCalls, 0);
  } finally { db.close(); }
});

test('HeyGen submission requires validated preview, matching continuity, and valid avatar inputs', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await assert.rejects(
      submitHeygenShot(db, job({ status: 'ready_for_validation' }), input(), { env }),
      { code: 'HEYGEN_PREVIEW_REQUIRED' }
    );
    await assert.rejects(
      submitHeygenShot(db, job(), { ...input(), continuity_cookie: 'old' }, { env }),
      { code: 'HEYGEN_STALE_PLAN' }
    );
    await assert.rejects(
      submitHeygenShot(db, job(), { ...input(), avatar_id: 'https://evil.test/a' }, { env }),
      { code: 'HEYGEN_AVATAR_VOICE_REQUIRED' }
    );
  } finally { db.close(); }
});

test('submission persists evidence once, hashes request bytes, and cannot resubmit on duplicate request', async () => {
  const db = new DatabaseSync(':memory:');
  const current = job();
  let count = 0;
  try {
    const fakeFetch = async (url, opts) => {
      count += 1;
      assert.equal(url, 'https://api.heygen.com/v3/videos');
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers['x-api-key'], env.HEYGEN_API_KEY);
      const body = JSON.parse(opts.body);
      assert.equal(body.script, current.blueprint.shots[0].narration);
      assert.equal(body.aspect_ratio, '9:16');
      assert.equal(body.type, 'avatar');
      assert.equal(body.resolution, '720p');
      assert.match(opts.headers['Idempotency-Key'], /^heygen_[a-z0-9-]+$/i);
      return mockResponse({ data: { video_id: 'video_confirmed_123' } });
    };
    const [first, duplicate] = await Promise.all([
      submitHeygenShot(db, current, input(current), { env, fetchImpl: fakeFetch }),
      submitHeygenShot(db, current, input(current), { env, fetchImpl: fakeFetch })
    ]);
    assert.equal(count, 1);
    assert.equal(first.reused, false);
    assert.equal(duplicate.reused, true);
    assert.equal(first.status, 'submitted');
    assert.equal(first.provider_video_id, 'video_confirmed_123');
    assert.match(first.request_sha256, /^[a-f0-9]{64}$/);
    assert.equal(first.authority_granted, false);
    assert.equal(first.media_verified, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM story_video_heygen_events').get().n, 2);
    assert.throws(() => {
      db.exec("UPDATE story_video_heygen_events SET event_type='altered'");
    }, /immutable/);
  } finally { db.close(); }
});

test('duplicate submit with changed avatar or voice fails closed without a second charge', async () => {
  const db = new DatabaseSync(':memory:');
  const current = job();
  let calls = 0;
  try {
    const fakeFetch = async () => {
      calls += 1;
      return mockResponse({ data: { video_id: 'video_confirmed_123' } });
    };
    await submitHeygenShot(db, current, input(current), { env, fetchImpl: fakeFetch });
    await assert.rejects(
      submitHeygenShot(db, current, { ...input(current), avatar_id: 'avatar_other' }, { env, fetchImpl: fakeFetch }),
      { code: 'HEYGEN_REQUEST_CONFLICT' }
    );
    assert.equal(calls, 1);
  } finally { db.close(); }
});

test('ambiguous provider failure is not automatically retried or falsely marked complete', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    let calls = 0;
    const fakeFetch = async () => { calls += 1; throw new Error('network uncertain'); };
    const first = await submitHeygenShot(db, job(), input(), { env, fetchImpl: fakeFetch });
    const second = await submitHeygenShot(db, job(), input(), { env, fetchImpl: fakeFetch });
    assert.equal(first.status, 'needs_reconcile');
    assert.equal(second.reused, true);
    assert.equal(calls, 1);
    assert.equal(first.provider_video_id, null);
  } finally { db.close(); }
});

test('provider completed status is NOT playable media proof and does not authorize publication', async () => {
  const db = new DatabaseSync(':memory:');
  const current = job();
  try {
    const sent = await submitHeygenShot(db, current, input(current), {
      env, fetchImpl: async () => mockResponse({ data: { video_id: 'video_confirmed_321' } })
    });
    const done = await refreshHeygenShot(db, current, sent.attempt_id, {
      env, fetchImpl: async (url, opts) => {
        assert.equal(url, 'https://api.heygen.com/v3/videos/video_confirmed_321');
        assert.equal(opts.headers['x-api-key'], env.HEYGEN_API_KEY);
        return mockResponse({ data: { id: 'video_confirmed_321', status: 'completed', video_url: 'https://example.com/bearer-media-url' } });
      }
    });
    assert.equal(done.status, 'provider_completed_unverified');
    assert.equal(done.media_verified, false);
    assert.equal(done.publish_approved, false);
    assert.equal(JSON.stringify(done).includes('bearer-media-url'), false);
    assert.equal(JSON.stringify(done).includes(env.HEYGEN_API_KEY), false);

    const anotherWorkspace = job({ workspace_id: 'workspace_two' });
    assert.equal(getHeygenAttempt(db, anotherWorkspace, sent.attempt_id), null);
    const stale = job({ source_revision_id: 'revision_two' });
    await assert.rejects(refreshHeygenShot(db, stale, sent.attempt_id, { env }), { code: 'HEYGEN_STALE_PLAN' });
  } finally { db.close(); }
});

test('normalized multi-shot route rejects stale cookie before any paid submission', async () => {
  const db = new DatabaseSync(':memory:');
  const originalKey = process.env.HEYGEN_API_KEY;
  const originalSwitch = process.env.HEYGEN_SUBMISSIONS_ENABLED;
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO stories (workspace_id,title,genre,pitch) VALUES (?,?,?,?)')
      .run('workspace-continuity', 'Violet Door', 'fantasy', 'Mina crosses a storm toward a glowing door.');
    db.prepare('INSERT INTO chapters (workspace_id,chapter_id,title,content,position) VALUES (?,?,?,?,?)')
      .run('workspace-continuity', 'chapter-1', 'Storm', 'Mina crosses the street and reaches for the glowing door.', 0);
    const created = createStoryVideoJob(db, {
      workspace_id: 'workspace-continuity',
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      action_beats: ['Mina crosses the rain-soaked street.', 'Mina reaches for the glowing door.']
    });
    const before = getStoryVideoJob(db, created.job_id);
    const staleCookie = createContinuityCookie(before).value;
    ensureHeygenSchema(db);
    const router = createRouter();
    videoEngineRoutes(router, db);
    process.env.HEYGEN_API_KEY = env.HEYGEN_API_KEY;
    process.env.HEYGEN_SUBMISSIONS_ENABLED = 'true';
    globalThis.fetch = async () => {
      providerCalls += 1;
      return mockResponse({ data: { video_id: 'video_confirmed_401' } });
    };

    const submit = payload => new Promise(resolve => {
      const req = new PassThrough();
      Object.assign(req, {
        method: 'POST',
        url: '/api/video-engine/jobs/' + created.job_id + '/heygen',
        headers: { 'content-type': 'application/json' },
        auth: {
          actor_id: 'founder_test', tenant_id: 'founder',
          role: 'administrator', workspace_ids: ['workspace-continuity']
        }
      });
      const res = {
        writableEnded: false, statusCode: 0,
        writeHead(status) { this.statusCode = status; },
        end(body = '') {
          this.writableEnded = true;
          resolve({ status: this.statusCode, body: JSON.parse(String(body)) });
        }
      };
      router.handle(req, res);
      req.end(JSON.stringify(payload));
    });

    const rejected = await submit({ ...input(before), continuity_cookie: staleCookie });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 'HEYGEN_STALE_PLAN');
    assert.equal(providerCalls, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM story_video_heygen_attempts').get().n, 0);

    const current = getStoryVideoJob(db, created.job_id);
    assert.notEqual(createContinuityCookie(current).value, staleCookie);
    const accepted = await submit(input(current));
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.status, 'submitted');
    assert.equal(providerCalls, 1);
    const reused = await submit(input(current));
    assert.equal(reused.status, 200);
    assert.equal(reused.body.reused, true);
    assert.equal(providerCalls, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM story_video_heygen_attempts').get().n, 1);
  } finally {
    if (originalKey === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = originalKey;
    if (originalSwitch === undefined) delete process.env.HEYGEN_SUBMISSIONS_ENABLED;
    else process.env.HEYGEN_SUBMISSIONS_ENABLED = originalSwitch;
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test('overlapping provider refreshes cannot regress completed media state', async () => {
  const db = new DatabaseSync(':memory:');
  const current = job();
  try {
    const submitted = await submitHeygenShot(db, current, input(current), {
      env, fetchImpl: async () => mockResponse({ data: { video_id: 'video_confirmed_987' } })
    });
    let releaseOlder, releaseNewer;
    const olderResponse = new Promise(resolve => { releaseOlder = resolve; });
    const newerResponse = new Promise(resolve => { releaseNewer = resolve; });
    const older = refreshHeygenShot(db, current, submitted.attempt_id, {
      env, fetchImpl: async () => olderResponse
    });
    const newer = refreshHeygenShot(db, current, submitted.attempt_id, {
      env, fetchImpl: async () => newerResponse
    });
    releaseNewer(mockResponse({ data: { id: 'video_confirmed_987', status: 'completed' } }));
    const finished = await newer;
    assert.equal(finished.status, 'provider_completed_unverified');
    releaseOlder(mockResponse({ data: { id: 'video_confirmed_987', status: 'processing' } }));
    const staleResult = await older;
    assert.equal(staleResult.status, 'provider_completed_unverified');
    const persisted = getHeygenAttempt(db, current, submitted.attempt_id);
    assert.equal(persisted.status, 'provider_completed_unverified');
    const events = db.prepare('SELECT event_type FROM story_video_heygen_events WHERE attempt_id=? ORDER BY sequence')
      .all(submitted.attempt_id).map(row => row.event_type);
    assert.deepEqual(events, ['submitting', 'submitted', 'provider_completed_unverified']);
  } finally { db.close(); }
});

test('HeyGen routes deny non-administrators before database access', () => {
  let reads = 0;
  const db = { prepare() { reads += 1; throw Error('no DB'); } };
  const router = createRouter();
  videoEngineRoutes(router, db);
  for (const url of [
    '/api/video-engine/heygen/status',
    '/api/video-engine/jobs/video_job_test/heygen/fake_attempt'
  ]) {
    const res = {
      writableEnded: false, statusCode: 0, body: '',
      writeHead(status) { this.statusCode = status; },
      end(body = '') { this.body = String(body); this.writableEnded = true; }
    };
    router.handle({
      method: 'GET', url, headers: {},
      auth: { actor_id: 'creator_one', tenant_id: 'tenant_one',
        role: 'creator', workspace_ids: ['workspace_one'] }
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'forbidden');
  }
  assert.equal(reads, 0);
});


test('HeyGen POST route denies creator before database lookup or provider call', async () => {
  let reads = 0;
  const db = { prepare() { reads += 1; throw Error('no DB'); } };
  const router = createRouter();
  videoEngineRoutes(router, db);
  const req = new PassThrough();
  Object.assign(req, {
    method: 'POST',
    url: '/api/video-engine/jobs/video_job_test/heygen',
    headers: { 'content-type': 'application/json' },
    auth: { actor_id: 'creator_one', tenant_id: 'tenant_one',
      role: 'creator', workspace_ids: ['workspace_one'] }
  });
  const res = {
    writableEnded: false, statusCode: 0, body: '',
    writeHead(status) { this.statusCode = status; },
    end(body = '') { this.body = String(body); this.writableEnded = true; }
  };
  router.handle(req, res);
  req.end(JSON.stringify({ shot_id: 'shot_01', approve_provider_spend: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'forbidden');
  assert.equal(reads, 0);
});
