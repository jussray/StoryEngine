import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  createImageGenerationJob,
  getImageGenerationFile,
  getImageGenerationJob,
  getWorkspaceCover,
  imageEngineOverview,
  listResumableImageJobs,
  pollImageGenerationJob,
  submitImageGenerationJob
} from '../lib/imageEngine.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const PNG_HASH = createHash('sha256').update(PNG_BYTES).digest('hex');

const storageDir = mkdtempSync(join(tmpdir(), 'l99-image-engine-'));
process.env.L99_IMAGE_OUTPUT_DIR = storageDir;

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.prepare(`INSERT INTO stories (workspace_id, title, genre, pitch) VALUES (?, ?, ?, ?)`)
    .run('workspace_image_test', 'The Lantern Door', 'fantasy', 'A child finds a door that only appears during storms.');
  return db;
}

function withToken(run) {
  const prior = process.env.REPLICATE_API_TOKEN;
  process.env.REPLICATE_API_TOKEN = 'test-token';
  return run().finally(() => {
    if (prior === undefined) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = prior;
  });
}

function withoutToken(run) {
  const prior = process.env.REPLICATE_API_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
  return run().finally(() => {
    if (prior !== undefined) process.env.REPLICATE_API_TOKEN = prior;
  });
}

// Scripted Replicate stand-in. Counts prediction creates so tests can prove
// the no-duplicate-billing law; poll outcomes are scripted per test.
function fakeReplicate({ pollScript = ['succeeded'], downloadFails = false } = {}) {
  const calls = { creates: 0, polls: 0, downloads: 0 };
  let pollIndex = 0;
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/v1/models/') && options.method === 'POST') {
      calls.creates += 1;
      return { ok: true, status: 201, json: async () => ({ id: 'pred_test_1', status: 'starting' }) };
    }
    if (href.includes('/v1/predictions/')) {
      calls.polls += 1;
      const status = pollScript[Math.min(pollIndex++, pollScript.length - 1)];
      if (status === 'succeeded') {
        return { ok: true, status: 200, json: async () => ({ id: 'pred_test_1', status, output: ['https://replicate.delivery/test/output.png'] }) };
      }
      if (status === 'failed') {
        return { ok: true, status: 200, json: async () => ({ id: 'pred_test_1', status, error: 'content flagged' }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'pred_test_1', status }) };
    }
    if (href === 'https://replicate.delivery/test/output.png') {
      calls.downloads += 1;
      if (downloadFails && calls.downloads === 1) return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength) };
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };
  return { fetchImpl, calls };
}

test('cover job composes its prompt from the story and the canon style contract', () => {
  const db = fixtureDb();
  try {
    const job = createImageGenerationJob(db, { workspace_id: 'workspace_image_test', purpose: 'book_cover', visual_style: 'sunset_lotus' });
    assert.equal(job.status, 'queued');
    assert.equal(job.reused, false);
    assert.match(job.prompt, /The Lantern Door/);
    assert.match(job.prompt, /sunset-lotus artwork world/);
    assert.match(job.negative_prompt, /no generic stock look/);
    assert.equal(job.aspect_ratio, '2:3');
    assert.ok(job.fingerprint.length === 64);
    assert.equal(job.estimated_cost_usd, 0.003);
  } finally { db.close(); }
});

test('identical generation requests dedupe on the fingerprint — never a second paid prediction', async () => {
  const db = fixtureDb();
  try {
    const input = { workspace_id: 'workspace_image_test', purpose: 'book_cover', visual_style: 'noir_gold_counsel' };
    const first = createImageGenerationJob(db, input);
    const second = createImageGenerationJob(db, input);
    assert.equal(second.reused, true);
    assert.equal(second.job_id, first.job_id);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM story_image_jobs').get();
    assert.equal(rows.n, 1);
    await withToken(async () => {
      const fake = fakeReplicate();
      await submitImageGenerationJob(db, first.job_id, { fetchImpl: fake.fetchImpl });
      // Resubmits and polls resume the SAME prediction; creates stay at 1.
      await submitImageGenerationJob(db, first.job_id, { fetchImpl: fake.fetchImpl });
      await pollImageGenerationJob(db, first.job_id, { fetchImpl: fake.fetchImpl });
      assert.equal(fake.calls.creates, 1);
    });
  } finally { db.close(); }
});

test('submit without a provider token fails closed as provider_unconfigured', async () => {
  const db = fixtureDb();
  try {
    const job = createImageGenerationJob(db, { workspace_id: 'workspace_image_test' });
    const submitted = await withoutToken(() => submitImageGenerationJob(db, job.job_id, { fetchImpl: async () => { throw new Error('must not be called'); } }));
    assert.equal(submitted.status, 'provider_unconfigured');
    assert.equal(submitted.provider_prediction_id, null);
    assert.equal(submitted.error.code, 'REPLICATE_NOT_CONFIGURED');
  } finally { db.close(); }
});

test('the prediction id is persisted before polling and survives as the resume handle', async () => {
  const db = fixtureDb();
  try {
    const job = createImageGenerationJob(db, { workspace_id: 'workspace_image_test' });
    await withToken(async () => {
      const fake = fakeReplicate({ pollScript: ['processing', 'processing'] });
      const submitted = await submitImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      assert.equal(submitted.provider_prediction_id, 'pred_test_1');
      assert.equal(submitted.status, 'processing');
      const polled = await pollImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      assert.equal(polled.status, 'processing');
      // A restart sees the same durable in-flight job, resumable by polling.
      const resumable = listResumableImageJobs(db);
      assert.equal(resumable.length, 1);
      assert.equal(resumable[0].provider_prediction_id, 'pred_test_1');
    });
  } finally { db.close(); }
});

test('a succeeded prediction is copied to durable storage and hash-verified before success is reported', async () => {
  const db = fixtureDb();
  try {
    const job = createImageGenerationJob(db, { workspace_id: 'workspace_image_test', visual_style: 'sunset_lotus' });
    await withToken(async () => {
      const fake = fakeReplicate();
      await submitImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      const done = await pollImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      assert.equal(done.status, 'succeeded');
      assert.equal(done.content_hash, PNG_HASH);
      assert.ok(done.storage_path.startsWith(storageDir));
      assert.ok(existsSync(done.storage_path));
      assert.equal(readFileSync(done.storage_path).length, PNG_BYTES.length);
      assert.equal(done.receipt.provider_prediction_id, 'pred_test_1');
      assert.equal(done.receipt.content_hash, PNG_HASH);
      const artifact = db.prepare('SELECT * FROM story_artifacts WHERE artifact_id=?').get(done.artifact_id);
      assert.equal(artifact.kind, 'generated_image');
      assert.equal(artifact.content_hash, PNG_HASH);
      const cover = getWorkspaceCover(db, 'workspace_image_test');
      assert.equal(cover.job_id, job.job_id);
      const file = getImageGenerationFile(db, job.job_id);
      assert.equal(file.content_type, 'image/png');
    });
  } finally { db.close(); }
});

test('a failed copy lands in copy_failed and the same prediction completes on the next poll', async () => {
  const db = fixtureDb();
  try {
    const job = createImageGenerationJob(db, { workspace_id: 'workspace_image_test' });
    await withToken(async () => {
      const fake = fakeReplicate({ downloadFails: true });
      await submitImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      const copyFailed = await pollImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      assert.equal(copyFailed.status, 'copy_failed');
      assert.equal(copyFailed.error.code, 'IMAGE_COPY_FAILED');
      const done = await pollImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      assert.equal(done.status, 'succeeded');
      assert.equal(fake.calls.creates, 1);
    });
  } finally { db.close(); }
});

test('a failed prediction marks the job failed with the provider error', async () => {
  const db = fixtureDb();
  try {
    const job = createImageGenerationJob(db, { workspace_id: 'workspace_image_test' });
    await withToken(async () => {
      const fake = fakeReplicate({ pollScript: ['failed'] });
      await submitImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      const failed = await pollImageGenerationJob(db, job.job_id, { fetchImpl: fake.fetchImpl });
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error.code, 'REPLICATE_PREDICTION_FAILED');
      assert.match(failed.error.message, /content flagged/);
    });
  } finally { db.close(); }
});

test('a workspace without a cover simply has none — the book is never blocked by the image engine', () => {
  const db = fixtureDb();
  try {
    assert.equal(getWorkspaceCover(db, 'workspace_image_test'), null);
    const overview = imageEngineOverview(db);
    assert.equal(overview.total_jobs, 0);
    assert.equal(overview.provider, 'replicate');
  } finally { db.close(); }
});

test('the cost cap refuses a job whose estimate exceeds it, before any provider spend', () => {
  const db = fixtureDb();
  try {
    assert.throws(
      () => createImageGenerationJob(db, { workspace_id: 'workspace_image_test', max_cost_usd: 0.001 }),
      error => error.code === 'IMAGE_COST_CAP_EXCEEDED'
    );
    const rows = db.prepare('SELECT COUNT(*) AS n FROM story_image_jobs').get();
    assert.equal(rows.n, 0);
  } finally { db.close(); }
});
