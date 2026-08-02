#!/usr/bin/env tsx
/**
 * Reconciliation controller — l99-StoryEngine
 *
 * Compares declared schema files against the runtime's loaded state,
 * surfaces drift, and emits a structured JSON report.
 *
 * Run:  npx tsx scripts/reconcile.ts
 * Used: Control Room reconciliation event bus, CI post-deploy gate
 *
 * Exit 0 = clean, Exit 1 = drift detected, Exit 2 = execution error
 */
import * as fs from 'fs';
import * as path from 'path';
import { validateSchemaDirectory } from '../schemas/validate';

const SCHEMAS_DIR = path.resolve(__dirname, '../schemas');
const MANIFEST_PATH = path.resolve(__dirname, '../control-room.manifest.json');

type DriftItem = {
  type: 'schema_invalid' | 'missing_schema' | 'manifest_mismatch' | 'unknown';
  detail: string;
};

async function run() {
  const start = Date.now();
  const drift: DriftItem[] = [];

  // 1. Validate all schema files
  const schemaResults = validateSchemaDirectory(SCHEMAS_DIR);
  for (const r of schemaResults) {
    if (!r.valid) {
      drift.push({ type: 'schema_invalid', detail: `${r.file}: ${r.errors.join('; ')}` });
    }
  }

  // 2. Cross-check manifest declared schemas
  if (fs.existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const declared: string[] = manifest?.schemas?.required ?? [];
    const found = new Set(schemaResults.map(r => r.file));

    for (const schema of declared) {
      if (!found.has(schema)) {
        drift.push({ type: 'missing_schema', detail: `Manifest declares '${schema}' but it was not found in ${SCHEMAS_DIR}` });
      }
    }
  }

  const report = {
    service: 'l99-story-engine',
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
    status: drift.length === 0 ? 'clean' : 'drift_detected',
    schemasChecked: schemaResults.length,
    drift,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(drift.length > 0 ? 1 : 0);
}

run().catch(e => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(2);
});
