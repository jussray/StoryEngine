import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ensureArtifactSchema, getArtifact, generateStoryArtifact } from '../lib/artifactValidation.js';
import { generateArtifactImage, imageAssetFile, listImageAssets, workspaceImageSpend } from '../lib/imageAssets.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const variables = ['IMAGE_PROVIDER','IMAGE_MODEL','REPLICATE_IMAGE_MODEL','REPLICATE_API_TOKEN','L99_IMAGE_OUTPUT_DIR','NODE_ENV'];

function isolatedEnvironment(t, values) {
  const old = Object.fromEntries(variables.map(key => [key, process.env[key]]));
  for (const key of variables) {
    if (key in values) process.env[key] = values[key];
    else delete process.env[key];
  }
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE stories(workspace_id TEXT PRIMARY KEY, title TEXT);");
  db.exec("CREATE TABLE chapters(id INTEGER PRIMARY KEY, workspace_id TEXT, title TEXT, content TEXT, position INTEGER);");
  db.exec("CREATE TABLE creative_profiles(workspace_id TEXT PRIMARY KEY, resolved_rules_json TEXT);");
  db.exec("INSERT INTO stories(workspace_id,title) VALUES('ws_visual','Unwritten Roads')");
  db.exec("INSERT INTO chapters(workspace_id,title,content,position) VALUES('ws_visual','Introduction','An opening passage about new ideas.',1)");
  ensureArtifactSchema(db);
  const html = '<!doctype html><html><head><title>Unwritten Roads</title></head><body><header><h1>Unwritten Roads</h1></header><section class="unit" data-testid="story-unit" data-unit-position="1"><h2>Introduction</h2><p>Content</p></section></body></html>';
  const now = Date.now();
  db.prepare('INSERT INTO story_artifacts (artifact_id,workspace_id,kind,title,status,content_hash,html,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('artifact_visual', 'ws_visual', 'html_preview', 'Unwritten Roads', 'validated', hash(html), html, '{}', now, now);
  return db;
}

test('absent provider leaves validated book byte-identical, with durable not-configured receipt', async t => {
  isolatedEnvironment(t, { NODE_ENV: 'test', IMAGE_PROVIDER: '', IMAGE_MODEL: '', REPLICATE_IMAGE_MODEL: '' });
  const db = fixture();
  t.after(() => db.close());
  const before = getArtifact(db, 'artifact_visual');
  const first = await generateArtifactImage(db, 'artifact_visual');
  const second = await generateArtifactImage(db, 'artifact_visual');
  assert.equal(first.status, 'not_configured');
  assert.equal(first.receipt.code, 'image_provider_not_configured');
  assert.equal(first.image_id, second.image_id);
  assert.equal(listImageAssets(db, 'artifact_visual').length, 1);
  const after = getArtifact(db, 'artifact_visual');
  assert.equal(after.html, before.html);
  assert.equal(after.content_hash, before.content_hash);
  assert.equal(after.status, 'validated');
  assert.deepEqual(workspaceImageSpend(db, 'ws_visual').statuses[0].status, 'not_configured');
});

test('test-double image is stored, attached, served by file lookup and not rebilled', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'storyengine-images-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  isolatedEnvironment(t, {
    NODE_ENV: 'test', IMAGE_PROVIDER: 'replicate',
    REPLICATE_IMAGE_MODEL: 'black-forest-labs/flux-schnell',
    REPLICATE_API_TOKEN: 'test-token', L99_IMAGE_OUTPUT_DIR: dir
  });
  const db = fixture();
  t.after(() => db.close());
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([String(url), options?.method]);
    if (options?.method === 'POST') {
      return new Response(JSON.stringify({
        id: 'testprediction123', status: 'succeeded',
        output: 'https://replicate.delivery/fake-cover.png'
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    return new Response(onePixelPng, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  const first = await generateArtifactImage(db, 'artifact_visual', { fetchImpl });
  assert.equal(first.status, 'complete');
  assert.equal(first.receipt.content_hash, hash(onePixelPng));
  const served = await imageAssetFile(db, first.image_id);
  assert.equal(served.mime_type, 'image/png');
  assert.deepEqual(await readFile(served.path), onePixelPng);
  const attached = getArtifact(db, 'artifact_visual');
  assert.match(attached.html, /data-testid="cover-image"/);
  assert.equal(attached.metadata.cover_image_id, first.image_id);
  assert.equal(attached.status, 'validated');
  assert.equal(attached.metadata.visual_overlay_validation, 'unverified');
  const second = await generateArtifactImage(db, 'artifact_visual', { fetchImpl });
  assert.equal(second.image_id, first.image_id);
  assert.equal(calls.filter(([,method]) => method === 'POST').length, 1);
  assert.equal(listImageAssets(db, 'artifact_visual').length, 1);
  const spend = workspaceImageSpend(db, 'ws_visual');
  assert.equal(spend.has_unknown_cost, true);
});
