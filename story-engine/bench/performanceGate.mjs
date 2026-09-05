import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';

import { list as listStories } from '../models/storyModel.js';
import { computeMetrics } from '../lib/oodaProcessor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineDir = join(__dirname, '..');
const schema = readFileSync(join(engineDir, 'db', 'schema.sql'), 'utf8');
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

const PREAGGREGATED_STORY_SQL = `
  WITH chapter_stats AS (
    SELECT workspace_id, COUNT(*) AS chapter_count
    FROM chapters
    GROUP BY workspace_id
  ),
  incident_stats AS (
    SELECT
      workspace_id,
      COUNT(*) AS active_incident_count,
      MAX(severity) AS highest_severity
    FROM lindymode_incidents
    WHERE status = 'active'
    GROUP BY workspace_id
  ),
  event_stats AS (
    SELECT workspace_id, MAX(created_at) AS last_activity_at
    FROM events
    GROUP BY workspace_id
  )
  SELECT
    s.*,
    COALESCE(c.chapter_count, 0) AS chapter_count,
    COALESCE(i.active_incident_count, 0) AS active_incident_count,
    i.highest_severity,
    e.last_activity_at
  FROM stories s
  LEFT JOIN chapter_stats c ON c.workspace_id = s.workspace_id
  LEFT JOIN incident_stats i ON i.workspace_id = s.workspace_id
  LEFT JOIN event_stats e ON e.workspace_id = s.workspace_id
  ORDER BY COALESCE(e.last_activity_at, s.updated_at, s.created_at) DESC
`;

function parseArgs(argv) {
  const parsed = { output: 'artifacts/performance-gate.json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output' && argv[i + 1]) {
      parsed.output = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}

function quantile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(values) {
  if (!values.length) return { min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
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

function roundMetrics(value) {
  if (Array.isArray(value)) return value.map(roundMetrics);
  if (!value || typeof value !== 'object') {
    return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, roundMetrics(child)]));
}

function measureSync(fn, { iterations = 10, warmups = 2 } = {}) {
  for (let i = 0; i < warmups; i += 1) fn();
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
  const heapAfter = process.memoryUsage().heapUsed;
  return {
    iterations,
    latency_ms: summarize(samples),
    cpu_ms: (cpu.user + cpu.system) / 1000,
    heap_delta_bytes: heapAfter - heapBefore,
    result_rows: Array.isArray(result) ? result.length : null
  };
}

async function measureAsync(fn, { iterations = 10, warmups = 2 } = {}) {
  for (let i = 0; i < warmups; i += 1) await fn();
  const samples = [];
  const cpuBefore = process.cpuUsage();
  const heapBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  const cpu = process.cpuUsage(cpuBefore);
  const heapAfter = process.memoryUsage().heapUsed;
  return {
    iterations,
    latency_ms: summarize(samples),
    cpu_ms: (cpu.user + cpu.system) / 1000,
    heap_delta_bytes: heapAfter - heapBefore
  };
}

async function measureTimerDelay(fn, iterations = 3) {
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

function planSummary(rows) {
  const details = rows.map(row => String(row.detail || ''));
  const count = pattern => details.filter(detail => pattern.test(detail)).length;
  return {
    details,
    scan_count: count(/\bSCAN\b/i),
    search_count: count(/\bSEARCH\b/i),
    correlated_subquery_count: count(/CORRELATED/i),
    temp_btree_count: count(/USE TEMP B-TREE/i),
    materialize_count: count(/MATERIALIZE/i)
  };
}

function withTransaction(db, work) {
  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedStoryListing(db, storyCount) {
  const story = db.prepare(`
    INSERT INTO stories (workspace_id, title, genre, pitch, created_at, updated_at)
    VALUES (?, ?, 'benchmark', 'measured performance gate', ?, ?)
  `);
  const chapter = db.prepare(`
    INSERT INTO chapters (workspace_id, chapter_id, title, content, status, position, created_at, updated_at)
    VALUES (?, ?, ?, 'benchmark text', 'Drafted', ?, ?, ?)
  `);
  const incident = db.prepare(`
    INSERT INTO lindymode_incidents (
      incident_id, correlation_id, workspace_id, event_type, severity, status,
      reason, drift_score, details_json, created_at
    ) VALUES (?, ?, ?, 'benchmark.continuity', ?, ?, 'benchmark', 0, '{}', ?)
  `);
  const event = db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES (?, 'chapter', 'operation.completed', '{}', ?, 0, ?)
  `);
  const now = Date.now();
  withTransaction(db, () => {
    for (let i = 0; i < storyCount; i += 1) {
      const workspaceId = `bench-story-${i}`;
      const createdAt = now - i * 100;
      story.run(workspaceId, `Story ${i}`, createdAt, createdAt);
      for (let chapterIndex = 0; chapterIndex < 5; chapterIndex += 1) {
        chapter.run(
          workspaceId,
          `chapter-${chapterIndex}`,
          `Chapter ${chapterIndex}`,
          chapterIndex,
          createdAt + chapterIndex,
          createdAt + chapterIndex
        );
      }
      incident.run(
        `incident-${i}-active`,
        `corr-${i}-active`,
        workspaceId,
        i % 2 === 0 ? 'sev2' : 'sev3',
        'active',
        createdAt + 20
      );
      incident.run(
        `incident-${i}-resolved`,
        `corr-${i}-resolved`,
        workspaceId,
        'sev1',
        'resolved',
        createdAt + 10
      );
      for (let eventIndex = 0; eventIndex < 10; eventIndex += 1) {
        event.run(workspaceId, 25 + ((i + eventIndex) % 250), createdAt + 30 + eventIndex);
      }
    }
  });
}

function normalizeStoryRows(rows) {
  return rows.map(row => ({
    workspace_id: row.workspace_id,
    chapter_count: Number(row.chapter_count || 0),
    active_incident_count: Number(row.active_incident_count || 0),
    highest_severity: row.highest_severity || null,
    last_activity_at: row.last_activity_at == null ? null : Number(row.last_activity_at)
  }));
}

function storyIterationCount(scale) {
  if (scale <= 10) return 30;
  if (scale <= 100) return 15;
  return 6;
}

function benchmarkStoryListing(scale) {
  const db = createDatabase();
  seedStoryListing(db, scale);

  let currentSql = '';
  const capturingDb = {
    prepare(sql) {
      currentSql = sql;
      return db.prepare(sql);
    }
  };
  const currentRows = listStories(capturingDb);
  const candidateRows = db.prepare(PREAGGREGATED_STORY_SQL).all();
  const correctnessMatches = JSON.stringify(normalizeStoryRows(currentRows)) === JSON.stringify(normalizeStoryRows(candidateRows));
  const iterations = storyIterationCount(scale);
  const current = measureSync(() => listStories(db), { iterations, warmups: 2 });
  const candidate = measureSync(() => db.prepare(PREAGGREGATED_STORY_SQL).all(), { iterations, warmups: 2 });
  const currentPlan = planSummary(db.prepare(`EXPLAIN QUERY PLAN ${currentSql}`).all());
  const candidatePlan = planSummary(db.prepare(`EXPLAIN QUERY PLAN ${PREAGGREGATED_STORY_SQL}`).all());

  db.close();
  return {
    stories: scale,
    child_rows_per_story: { chapters: 5, incidents: 2, events: 10 },
    correctness_matches: correctnessMatches,
    current,
    independent_preaggregation_candidate: candidate,
    current_plan: currentPlan,
    candidate_plan: candidatePlan,
    p95_speedup_candidate_vs_current: candidate.latency_ms.p95 > 0
      ? current.latency_ms.p95 / candidate.latency_ms.p95
      : null
  };
}

function seedOodaEvents(db, count) {
  const insert = db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES (?, ?, ?, '{}', ?, ?, ?)
  `);
  const now = Date.now();
  withTransaction(db, () => {
    for (let i = 0; i < count; i += 1) {
      insert.run(
        `ooda-ws-${i % 12}`,
        i % 3 === 0 ? 'movie' : 'chapter',
        i % 97 === 0 ? 'operation.failed' : 'operation.completed',
        20 + (i % 2980),
        i % 53 === 0 ? 1 : 0,
        now - (i % (DEFAULT_WINDOW_MS - 1000))
      );
    }
  });
}

function oodaIterations(scale) {
  if (scale <= 1000) return 15;
  if (scale <= 10000) return 8;
  return 3;
}

async function benchmarkOoda(scale) {
  const db = createDatabase();
  seedOodaEvents(db, scale);
  let metricSql = '';
  const capturingDb = {
    prepare(sql) {
      if (sql.includes('FROM events') && sql.includes('created_at >= ?')) metricSql = sql;
      return db.prepare(sql);
    }
  };
  computeMetrics(capturingDb);
  const iterations = oodaIterations(scale);
  const compute = measureSync(() => computeMetrics(db), { iterations, warmups: 1 });
  const timerDelay = await measureTimerDelay(() => computeMetrics(db), 3);
  const plan = metricSql
    ? planSummary(db.prepare(`EXPLAIN QUERY PLAN ${metricSql}`).all(Date.now() - DEFAULT_WINDOW_MS))
    : null;
  return { db, result: { events: scale, compute, timer_delay_ms: timerDelay, query_plan: plan } };
}

async function httpProbe(db, { withOoda, requests = 80 } = {}) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/creator`;
  let oodaRan = false;
  if (withOoda) {
    setTimeout(() => {
      oodaRan = true;
      computeMetrics(db);
    }, 0);
  }
  const samples = await Promise.all(Array.from({ length: requests }, async () => {
    const started = performance.now();
    const response = await fetch(url);
    await response.text();
    return { latency: performance.now() - started, ok: response.ok };
  }));
  await new Promise(resolve => server.close(resolve));
  return {
    requests,
    success_rate: samples.filter(sample => sample.ok).length / requests,
    latency_ms: summarize(samples.map(sample => sample.latency)),
    ooda_job_ran: oodaRan
  };
}

async function benchmarkOodaHttpImpact(db) {
  const disabled = await httpProbe(db, { withOoda: false });
  const enabled = await httpProbe(db, { withOoda: true });
  return {
    ooda_disabled: disabled,
    ooda_enabled: enabled,
    p95_delta_ms: enabled.latency_ms.p95 - disabled.latency_ms.p95,
    p99_delta_ms: enabled.latency_ms.p99 - disabled.latency_ms.p99
  };
}

async function benchmarkStaticAssets() {
  const candidates = ['front_door.html', 'control_room.html', 'story_engine.html']
    .map(name => join(engineDir, 'public', name))
    .filter(existsSync);
  const results = [];
  for (const filePath of candidates) {
    const cache = new Map([[filePath, readFileSync(filePath)]]);
    const sizeBytes = cache.get(filePath).byteLength;
    const sync = measureSync(() => readFileSync(filePath), { iterations: 40, warmups: 3 });
    const asyncRead = await measureAsync(() => readFile(filePath), { iterations: 40, warmups: 3 });
    const cached = measureSync(() => cache.get(filePath), { iterations: 5000, warmups: 50 });
    const syncTimerDelay = await measureTimerDelay(() => {
      for (let i = 0; i < 25; i += 1) readFileSync(filePath);
    }, 3);
    results.push({
      asset: relative(engineDir, filePath),
      size_bytes: sizeBytes,
      sync_read: sync,
      async_read: asyncRead,
      cached_read: cached,
      sync_batch_25_timer_delay_ms: syncTimerDelay
    });
  }
  return results;
}

class SlowSink extends Writable {
  constructor({ highWaterMark = 1024, delayMs = 5 } = {}) {
    super({ highWaterMark });
    this.delayMs = delayMs;
    this.on('error', () => {});
  }

  _write(_chunk, _encoding, callback) {
    setTimeout(callback, this.delayMs);
  }
}

function sendSseModel(stream, eventName, data) {
  return [
    stream.write(`event: ${eventName}\n`),
    stream.write(`data: ${JSON.stringify(data)}\n\n`)
  ];
}

function benchmarkSseBackpressure(clientCount) {
  const clients = Array.from({ length: clientCount }, () => new SlowSink({ highWaterMark: 1024, delayMs: 5 }));
  const payload = {
    incidents: Array.from({ length: 20 }, (_, index) => ({
      incident_id: `bench-${index}`,
      workspace_id: `ws-${index % 4}`,
      severity: index % 4 === 0 ? 'critical' : 'warning',
      summary: `controlled slow-client backpressure payload ${index} ${'x'.repeat(180)}`
    }))
  };
  let falseWrites = 0;
  let totalWrites = 0;
  const started = performance.now();
  for (let broadcast = 0; broadcast < 10; broadcast += 1) {
    for (const client of clients) {
      for (const accepted of sendSseModel(client, 'incidents', payload)) {
        totalWrites += 1;
        if (!accepted) falseWrites += 1;
      }
    }
  }
  const enqueueMs = performance.now() - started;
  const bufferedBytes = clients.reduce((sum, client) => sum + client.writableLength, 0);
  for (const client of clients) client.destroy();
  return {
    clients: clientCount,
    broadcasts: 10,
    total_writes: totalWrites,
    false_writes: falseWrites,
    false_write_rate: totalWrites ? falseWrites / totalWrites : 0,
    buffered_bytes_after_enqueue: bufferedBytes,
    enqueue_ms: enqueueMs,
    model: 'controlled Node Writable with 1KiB highWaterMark and 5ms write delay; not a production TCP socket claim'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storyListing = [10, 100, 1000].map(benchmarkStoryListing);
  const oodaResults = [];
  let largestOodaDb = null;
  for (const scale of [1000, 10000, 100000]) {
    const measured = await benchmarkOoda(scale);
    oodaResults.push(measured.result);
    if (largestOodaDb) largestOodaDb.close();
    largestOodaDb = measured.db;
  }
  const httpImpact = await benchmarkOodaHttpImpact(largestOodaDb);
  largestOodaDb.close();
  const staticAssets = await benchmarkStaticAssets();
  const sse = [1, 10, 50, 100].map(benchmarkSseBackpressure);

  const report = roundMetrics({
    schema: 'l99.performance-gate@v1',
    generated_at: new Date().toISOString(),
    proof_subject: process.env.EXPECTED_HEAD_SHA || process.env.GITHUB_SHA || null,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    story_listing: storyListing,
    ooda_scan: oodaResults,
    event_loop_http_probe_at_100k_events: httpImpact,
    static_serving: staticAssets,
    sse_backpressure: sse,
    interpretation_rules: [
      'A correlated query is not declared slow merely because it is correlated; compare plan and timings.',
      'The independent preaggregation SQL is a benchmark candidate only and is not production-approved by this harness.',
      'OODA HTTP probe measures same-process Node event-loop contention using the real computeMetrics function, not full creator-route business logic.',
      'SSE backpressure uses a deterministic slow Writable model so false write signals and queued bytes are observable; it is not a production socket p99 claim.',
      'Static async/cache variants are candidates only. No production static-serving behavior is changed by this benchmark.'
    ]
  });

  const outputPath = join(process.cwd(), args.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const largestStory = report.story_listing.at(-1);
  const largestOoda = report.ooda_scan.at(-1);
  const slowestSse = report.sse_backpressure.at(-1);
  console.log(JSON.stringify({
    output: outputPath,
    story_1000_current_p95_ms: largestStory.current.latency_ms.p95,
    story_1000_candidate_p95_ms: largestStory.independent_preaggregation_candidate.latency_ms.p95,
    story_1000_candidate_speedup: largestStory.p95_speedup_candidate_vs_current,
    story_current_correlated_subqueries: largestStory.current_plan.correlated_subquery_count,
    ooda_100k_p95_ms: largestOoda.compute.latency_ms.p95,
    ooda_100k_timer_delay_p95_ms: largestOoda.timer_delay_ms.p95,
    creator_http_p95_delta_ms: report.event_loop_http_probe_at_100k_events.p95_delta_ms,
    sse_100_clients_false_write_rate: slowestSse.false_write_rate,
    sse_100_clients_buffered_bytes: slowestSse.buffered_bytes_after_enqueue
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
