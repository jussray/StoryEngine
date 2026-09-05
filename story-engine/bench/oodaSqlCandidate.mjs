import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { computeMetrics } from '../lib/oodaProcessor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineDir = join(__dirname, '..');
const schema = readFileSync(join(engineDir, 'db', 'schema.sql'), 'utf8');
const WINDOW_MS = 15 * 60 * 1000;

const SQL_CANDIDATE = `
  WITH filtered AS (
    SELECT workspace_id, mode, duration_ms, rollback
    FROM events
    WHERE created_at >= ?
      AND COALESCE(mode, '') NOT IN ('ooda', 'autonomous_runtime')
      AND event_type NOT LIKE 'runtime.%'
      AND event_type NOT LIKE 'release.%'
  ),
  summary AS (
    SELECT
      workspace_id,
      mode,
      COUNT(*) AS total_events,
      SUM(CASE WHEN rollback THEN 1 ELSE 0 END) AS rollbacks
    FROM filtered
    GROUP BY workspace_id, mode
  ),
  ranked AS (
    SELECT
      workspace_id,
      mode,
      duration_ms,
      ROW_NUMBER() OVER (
        PARTITION BY workspace_id, mode
        ORDER BY duration_ms ASC
      ) AS rn,
      COUNT(*) OVER (
        PARTITION BY workspace_id, mode
      ) AS duration_count
    FROM filtered
    WHERE duration_ms IS NOT NULL
  ),
  percentiles AS (
    SELECT
      workspace_id,
      mode,
      MAX(CASE
        WHEN rn = CAST((duration_count * 50 + 99) / 100 AS INTEGER)
        THEN duration_ms
      END) AS p50,
      MAX(CASE
        WHEN rn = CAST((duration_count * 95 + 99) / 100 AS INTEGER)
        THEN duration_ms
      END) AS p95,
      MAX(CASE
        WHEN rn = CAST((duration_count * 99 + 99) / 100 AS INTEGER)
        THEN duration_ms
      END) AS p99
    FROM ranked
    GROUP BY workspace_id, mode
  )
  SELECT
    s.workspace_id,
    s.mode,
    s.total_events,
    COALESCE(p.p50, 0) AS p50,
    COALESCE(p.p95, 0) AS p95,
    COALESCE(p.p99, 0) AS p99,
    CASE
      WHEN s.total_events > 0 THEN CAST(s.rollbacks AS REAL) / s.total_events
      ELSE 0
    END AS rollback_rate
  FROM summary s
  LEFT JOIN percentiles p
    ON p.workspace_id = s.workspace_id
   AND p.mode IS s.mode
  ORDER BY s.workspace_id, s.mode
`;

function parseArgs(argv) {
  const parsed = { output: 'artifacts/ooda-sql-candidate.json' };
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

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
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

function computeCandidate(db, windowMs = WINDOW_MS) {
  const since = Date.now() - windowMs;
  return db.prepare(SQL_CANDIDATE).all(since).map(row => ({
    workspace_id: row.workspace_id,
    mode: row.mode,
    total_events: Number(row.total_events || 0),
    p50: Number(row.p50 || 0),
    p95: Number(row.p95 || 0),
    p99: Number(row.p99 || 0),
    rollback_rate: Number(row.rollback_rate || 0)
  }));
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

function measure(fn, iterations) {
  fn();
  const samples = [];
  const cpuBefore = process.cpuUsage();
  const heapBefore = process.memoryUsage().heapUsed;
  let result;
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    result = fn();
    samples.push(performance.now() - started);
  }
  const cpu = process.cpuUsage(cpuBefore);
  return {
    iterations,
    latency_ms: summarize(samples),
    cpu_ms: (cpu.user + cpu.system) / 1000,
    heap_delta_bytes: process.memoryUsage().heapUsed - heapBefore,
    result_rows: result.length
  };
}

async function timerDelay(fn, iterations = 3) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
    const started = performance.now();
    const timer = new Promise(resolve => setTimeout(() => resolve(performance.now() - started), 0));
    fn();
    samples.push(await timer);
  }
  return summarize(samples);
}

function plan(db, sql) {
  const details = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(Date.now() - WINDOW_MS).map(row => String(row.detail || ''));
  return {
    details,
    scan_count: details.filter(item => /\bSCAN\b/i.test(item)).length,
    search_count: details.filter(item => /\bSEARCH\b/i.test(item)).length,
    temp_btree_count: details.filter(item => /USE TEMP B-TREE/i.test(item)).length,
    materialize_count: details.filter(item => /MATERIALIZE/i.test(item)).length
  };
}

async function httpProbe(db, computeFn, requests = 80) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  let computeRan = false;
  if (computeFn) {
    setTimeout(() => {
      computeRan = true;
      computeFn(db);
    }, 0);
  }
  const samples = await Promise.all(Array.from({ length: requests }, async () => {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/creator`);
    await response.text();
    return { ok: response.ok, latency: performance.now() - started };
  }));
  await new Promise(resolve => server.close(resolve));
  return {
    requests,
    success_rate: samples.filter(sample => sample.ok).length / requests,
    compute_ran: computeRan,
    latency_ms: summarize(samples.map(sample => sample.latency))
  };
}

function iterationsFor(scale) {
  if (scale <= 1000) return 15;
  if (scale <= 10000) return 8;
  return 3;
}

async function benchmarkScale(scale) {
  const db = createDb();
  seed(db, scale);
  const currentRows = computeMetrics(db);
  const candidateRows = computeCandidate(db);
  const correctness = JSON.stringify(normalize(currentRows)) === JSON.stringify(normalize(candidateRows));
  const iterations = iterationsFor(scale);
  const current = measure(() => computeMetrics(db), iterations);
  const candidate = measure(() => computeCandidate(db), iterations);
  const currentDelay = await timerDelay(() => computeMetrics(db));
  const candidateDelay = await timerDelay(() => computeCandidate(db));
  const result = {
    events: scale,
    correctness_matches: correctness,
    current,
    sql_candidate: candidate,
    current_timer_delay_ms: currentDelay,
    candidate_timer_delay_ms: candidateDelay,
    p95_speedup: candidate.latency_ms.p95 > 0 ? current.latency_ms.p95 / candidate.latency_ms.p95 : null,
    p95_timer_delay_reduction_ms: currentDelay.p95 - candidateDelay.p95,
    candidate_plan: plan(db, SQL_CANDIDATE)
  };
  return { db, result };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scales = [];
  let largestDb;
  for (const scale of [1000, 10000, 100000]) {
    const measured = await benchmarkScale(scale);
    scales.push(measured.result);
    if (largestDb) largestDb.close();
    largestDb = measured.db;
  }

  const http = {
    disabled: await httpProbe(largestDb, null),
    current: await httpProbe(largestDb, computeMetrics),
    sql_candidate: await httpProbe(largestDb, computeCandidate)
  };
  http.current_p95_delta_ms = http.current.latency_ms.p95 - http.disabled.latency_ms.p95;
  http.candidate_p95_delta_ms = http.sql_candidate.latency_ms.p95 - http.disabled.latency_ms.p95;
  http.current_p99_delta_ms = http.current.latency_ms.p99 - http.disabled.latency_ms.p99;
  http.candidate_p99_delta_ms = http.sql_candidate.latency_ms.p99 - http.disabled.latency_ms.p99;
  largestDb.close();

  const report = round({
    schema: 'l99.ooda-sql-candidate@v1',
    generated_at: new Date().toISOString(),
    proof_subject: process.env.EXPECTED_HEAD_SHA || process.env.GITHUB_SHA || null,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    scales,
    http_probe_at_100k_events: http,
    decision_rule: 'Candidate may be promoted only if correctness matches at every scale and measured 100k event-loop/HTTP impact improves materially without changing OODA semantics.'
  });

  const outputPath = join(process.cwd(), args.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const largest = report.scales.at(-1);
  console.log(JSON.stringify({
    output: outputPath,
    correctness_all_scales: report.scales.every(item => item.correctness_matches),
    current_100k_p95_ms: largest.current.latency_ms.p95,
    candidate_100k_p95_ms: largest.sql_candidate.latency_ms.p95,
    p95_speedup: largest.p95_speedup,
    current_timer_delay_p95_ms: largest.current_timer_delay_ms.p95,
    candidate_timer_delay_p95_ms: largest.candidate_timer_delay_ms.p95,
    current_http_p95_delta_ms: report.http_probe_at_100k_events.current_p95_delta_ms,
    candidate_http_p95_delta_ms: report.http_probe_at_100k_events.candidate_p95_delta_ms
  }, null, 2));

  if (!report.scales.every(item => item.correctness_matches)) process.exitCode = 2;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
