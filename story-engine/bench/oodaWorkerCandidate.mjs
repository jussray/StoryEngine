import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

import { computeMetrics } from '../lib/oodaProcessor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineDir = join(__dirname, '..');
const schema = readFileSync(join(engineDir, 'db', 'schema.sql'), 'utf8');
const WINDOW_MS = 15 * 60 * 1000;

function parseArgs(argv) {
  const parsed = { output: 'artifacts/ooda-worker-candidate.json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output' && argv[i + 1]) {
      parsed.output = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}

function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarize(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...values),
    mean: total / values.length,
    p50: quantile(values, 50),
    p95: quantile(values, 95),
    p99: quantile(values, 99),
    max: Math.max(...values)
  };
}

function round(value) {
  if (Array.isArray(value)) return value.map(round);
  if (!value || typeof value !== 'object') {
    return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, round(child)]));
}

function normalize(rows) {
  return rows
    .map(row => ({
      workspace_id: row.workspace_id,
      mode: row.mode ?? null,
      total_events: Number(row.total_events || 0),
      p50: Number(row.p50 || 0),
      p95: Number(row.p95 || 0),
      p99: Number(row.p99 || 0),
      rollback_rate: Number(Number(row.rollback_rate || 0).toFixed(12))
    }))
    .sort((a, b) => `${a.workspace_id}::${a.mode ?? ''}`.localeCompare(`${b.workspace_id}::${b.mode ?? ''}`));
}

function seed(db, count) {
  const insert = db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES (?, ?, ?, '{}', ?, ?, ?)
  `);
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (let i = 0; i < count; i += 1) {
      insert.run(
        `ooda-ws-${i % 12}`,
        i % 3 === 0 ? 'movie' : 'chapter',
        i % 97 === 0 ? 'operation.failed' : 'operation.completed',
        i % 131 === 0 ? null : 20 + (i % 2980),
        i % 53 === 0 ? 1 : 0,
        now - (i % (WINDOW_MS - 1000))
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createWorker(dbPath) {
  return new Worker(new URL('./oodaWorkerCandidateWorker.mjs', import.meta.url), {
    workerData: { dbPath }
  });
}

function workerRun(worker, id) {
  return new Promise((resolve, reject) => {
    const onMessage = message => {
      if (message?.id !== id) return;
      if (message.type === 'result') {
        cleanup();
        resolve(message);
      } else if (message.type === 'error') {
        cleanup();
        reject(new Error(message.error));
      }
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.postMessage({ type: 'run', id });
  });
}

async function measureWorker(worker, iterations = 3) {
  const samples = [];
  let metrics = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    const result = await workerRun(worker, `measure-${i}`);
    samples.push(performance.now() - started);
    metrics = result.metrics;
  }
  return { iterations, roundtrip_latency_ms: summarize(samples), metrics };
}

async function measureMainTimerDuringWorker(worker, iterations = 3) {
  const timerSamples = [];
  const workerSamples = [];
  for (let i = 0; i < iterations; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
    const started = performance.now();
    const timer = new Promise(resolve => setTimeout(() => resolve(performance.now() - started), 0));
    const workerStarted = performance.now();
    const workerResultPromise = workerRun(worker, `timer-${i}`);
    timerSamples.push(await timer);
    const workerResult = await workerResultPromise;
    workerSamples.push(performance.now() - workerStarted);
    if (!Array.isArray(workerResult.metrics)) throw new Error('Worker did not return metrics.');
  }
  return {
    main_timer_delay_ms: summarize(timerSamples),
    worker_roundtrip_ms: summarize(workerSamples)
  };
}

async function httpProbe({ db, worker, mode, requests = 80 }) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  let backgroundPromise = null;
  if (mode === 'main') {
    setTimeout(() => computeMetrics(db), 0);
  } else if (mode === 'worker') {
    backgroundPromise = new Promise(resolve => {
      setTimeout(() => resolve(workerRun(worker, `http-${Date.now()}`)), 0);
    }).then(value => value);
  }
  const samples = await Promise.all(Array.from({ length: requests }, async () => {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/creator`);
    await response.text();
    return { ok: response.ok, latency: performance.now() - started };
  }));
  if (backgroundPromise) await backgroundPromise;
  await new Promise(resolve => server.close(resolve));
  return {
    requests,
    success_rate: samples.filter(sample => sample.ok).length / requests,
    latency_ms: summarize(samples.map(sample => sample.latency))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tempDir = await mkdtemp(join(tmpdir(), 'l99-ooda-worker-'));
  const dbPath = join(tempDir, 'ooda-worker.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(schema);
  seed(db, 100000);

  const worker = createWorker(dbPath);
  const current = computeMetrics(db);
  const workerMeasure = await measureWorker(worker, 3);
  const correctnessMatches = JSON.stringify(normalize(current)) === JSON.stringify(normalize(workerMeasure.metrics));
  const timer = await measureMainTimerDuringWorker(worker, 3);
  const http = {
    disabled: await httpProbe({ db, worker, mode: 'disabled' }),
    main_thread_ooda: await httpProbe({ db, worker, mode: 'main' }),
    worker_ooda: await httpProbe({ db, worker, mode: 'worker' })
  };
  http.main_p95_delta_ms = http.main_thread_ooda.latency_ms.p95 - http.disabled.latency_ms.p95;
  http.worker_p95_delta_ms = http.worker_ooda.latency_ms.p95 - http.disabled.latency_ms.p95;
  http.main_p99_delta_ms = http.main_thread_ooda.latency_ms.p99 - http.disabled.latency_ms.p99;
  http.worker_p99_delta_ms = http.worker_ooda.latency_ms.p99 - http.disabled.latency_ms.p99;

  const report = round({
    schema: 'l99.ooda-worker-candidate@v1',
    generated_at: new Date().toISOString(),
    proof_subject: process.env.EXPECTED_HEAD_SHA || process.env.GITHUB_SHA || null,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    events: 100000,
    correctness_matches: correctnessMatches,
    worker_roundtrip: workerMeasure.roundtrip_latency_ms,
    worker_main_timer_isolation: timer,
    http_probe: http,
    decision_rule: 'Promote only if worker output is semantically identical and main-loop timer/HTTP contention falls materially without reducing request success.'
  });

  const outputPath = join(process.cwd(), args.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));

  await worker.terminate();
  db.close();
  await rm(tempDir, { recursive: true, force: true });
  if (!correctnessMatches) process.exitCode = 2;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
