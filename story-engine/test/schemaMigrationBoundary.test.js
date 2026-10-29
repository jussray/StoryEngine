import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

test('schema keeps all table DDL before the first index migration boundary', () => {
  const firstIndexOffset = schema.indexOf('\nCREATE INDEX IF NOT EXISTS ');
  assert.ok(firstIndexOffset > 0, 'schema must contain an index migration boundary');

  const tableDdl = schema.slice(0, firstIndexOffset);
  const indexDdl = schema.slice(firstIndexOffset);

  assert.match(tableDdl, /CREATE TABLE IF NOT EXISTS story_genome_versions/);
  assert.match(tableDdl, /CREATE TABLE IF NOT EXISTS memory_diffs/);
  assert.doesNotMatch(indexDdl, /CREATE TABLE IF NOT EXISTS /);
});
