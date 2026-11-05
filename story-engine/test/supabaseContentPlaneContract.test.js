import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  __dirname,
  '../../supabase/migrations/20260920215500_storyengine_content_plane.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

const tables = [
  'stories',
  'workspace_memberships',
  'outlines',
  'chapters',
  'story_artifacts'
];

test('Supabase content plane owns the existing StoryEngine durable table names', () => {
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
  }
  assert.doesNotMatch(sql, /storyengine_(stories|chapters|outlines|artifacts)/i);
});

test('every content table is fail-closed behind RLS and no client grants', () => {
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant all on table public\\.${table} to service_role`, 'i'));
  }
  assert.doesNotMatch(sql, /create\s+policy[\s\S]*to\s+(anon|authenticated)/i);
});

test('workspace membership roles stay identical to the runtime authority roles', () => {
  const securityContext = readFileSync(join(__dirname, '../lib/securityContext.js'), 'utf8');
  const runtimeRoleBlock = securityContext.match(/ROLE_ORDER\s*=\s*Object\.freeze\(\{([^}]+)\}\)/);
  assert.ok(runtimeRoleBlock, 'ROLE_ORDER authority contract not found');
  const runtimeRoles = [...runtimeRoleBlock[1].matchAll(/([a-z_]+)\s*:/g)].map(match => match[1]);

  const migrationRoleBlock = sql.match(/workspace_memberships_role_check[\s\S]*?check\s*\(\s*role\s+in\s*\(([^)]+)\)\s*\)/i);
  assert.ok(migrationRoleBlock, 'workspace membership role check not found');
  const migrationRoles = [...migrationRoleBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]);

  assert.deepEqual(migrationRoles, runtimeRoles);
});

test('migration carries tenant, creator, membership, artifact, and fail-closed shape checks', () => {
  for (const token of [
    'tenant_id',
    'created_by_actor_id',
    'workspace_memberships',
    'actor_id',
    'artifact_id',
    'validation_json',
    'information_schema.columns',
    'raise exception'
  ]) {
    assert.ok(sql.includes(token), `missing migration contract token: ${token}`);
  }
});

test('Supabase repository config is seed-safe and exposes only expected API schemas', () => {
  const config = readFileSync(join(__dirname, '../../supabase/config.toml'), 'utf8');
  assert.match(config, /project_id\s*=\s*"storyengine"/);
  assert.match(config, /schemas\s*=\s*\["public",\s*"graphql_public"\]/);
  assert.match(config, /\[db\.seed\][\s\S]*enabled\s*=\s*false/);
  assert.doesNotMatch(config, /(secret|password|token)\s*=/i);
});