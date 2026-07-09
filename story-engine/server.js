// server.js — L99 Story Engine
// Zero dependencies. Requires Node 22.5+ for node:sqlite.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import db from './config/db.js';
import { createRouter } from './lib/miniRouter.js';
import { requestContext, requireAuth, enforceWorkspaceAccess, securitySnapshot } from './lib/securityContext.js';
import { startOODALoop } from './lib/oodaProcessor.js';
import { startRuntimeScheduler } from './lib/runtimeDispatcher.js';
import { llmRoutingSnapshot } from './lib/llmClient.js';

import storyRoutes from './routes/story.js';
import outlineRoutes from './routes/outline.js';
import chapterRoutes from './routes/chapters.js';
import chapterMaintenanceRoutes from './routes/chapterMaintenance.js';
import movieRoutes from './routes/movie.js';
import eventsRoutes from './routes/events.js';
import lindymodeRoutes from './routes/lindymode.js';
import oodaRoutes from './routes/ooda.js';
import decisionRoutes from './routes/decision.js';
import learningRoutes from './routes/learning.js';
import recoveryRoutes from './routes/recovery.js';
import runtimeRoutes from './routes/runtime.js';
import missionControlRoutes from './routes/missionControl.js';
import eventRetentionRoutes from './routes/eventRetention.js';
import releaseGateRoutes from './routes/releaseGate.js';
import releaseAttemptRoutes from './routes/releaseAttempts.js';
import controlRoomRoutes from './routes/controlRoom.js';
import memoryRoutes from './routes/memory.js';
import performanceRoutes from './routes/performance.js';
import studioRoutes from './routes/studio.js';
import creativeProfileRoutes from './routes/creativeProfile.js';
import auditRoutes from './routes/audit.js';
import storyEngineRoutes from './routes/storyEngine.js';
import assistModeRoutes from './routes/assistMode.js';
import audienceLensRoutes from './routes/audienceLens.js';
import blueprintRoutes from './routes/blueprint.js';
import validationSeedRoutes from './routes/validationSeed.js';
import ipGrowthRoutes from './routes/ipGrowth.js';
import ipStudioRoutes from './routes/ipStudio.js';
import campaignStudioRoutes from './routes/campaignStudio.js';
import bootstrapEngineRoutes from './routes/bootstrapEngine.js';
import ipSeedRoutes from './routes/ipSeed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_MAX_BODY_BYTES = Number(process.env.API_MAX_BODY_BYTES || 2 * 1024 * 1024);

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

const router = createRouter({ maxBodyBytes: API_MAX_BODY_BYTES });
router.use('/api', requestContext);
router.use('/api', requireAuth);
router.use('/api', enforceWorkspaceAccess);
storyRoutes(router, db);
outlineRoutes(router, db);
chapterRoutes(router, db);
chapterMaintenanceRoutes(router, db);
movieRoutes(router, db);
eventsRoutes(router, db);
lindymodeRoutes(router, db);
oodaRoutes(router, db);
decisionRoutes(router, db);
learningRoutes(router, db);
recoveryRoutes(router, db);
runtimeRoutes(router, db);
missionControlRoutes(router, db);
eventRetentionRoutes(router, db);
releaseGateRoutes(router, db);
releaseAttemptRoutes(router, db);
controlRoomRoutes(router, db);
memoryRoutes(router, db);
performanceRoutes(router, db);
studioRoutes(router, db);
creativeProfileRoutes(router, db);
auditRoutes(router, db);
storyEngineRoutes(router, db);
assistModeRoutes(router, db);
audienceLensRoutes(router, db);
blueprintRoutes(router, db);
validationSeedRoutes(router, db);
ipGrowthRoutes(router, db);
ipStudioRoutes(router, db);
campaignStudioRoutes(router, db);
bootstrapEngineRoutes(router, db);
ipSeedRoutes(router, db);

const oodaClients = new Set();
let latestIncidents = [];

function sendSse(res, name, data) {
  res.write(`event: ${name}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastIncidents(incidents) {
  latestIncidents = incidents;
  for (const res of oodaClients) sendSse(res, 'incidents', incidents);
}

function openOodaStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  sendSse(res, 'heartbeat', { t: Date.now(), request_id: req.request_id });
  sendSse(res, 'incidents', latestIncidents);
  oodaClients.add(res);
  req.on('close', () => oodaClients.delete(res));
}

function serveStatic(filePath, ext, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (ext === '.html') {
    const html = readFileSync(filePath, 'utf8');
    const injected = html.includes('/l99_auth.js')
      ? html
      : html.replace('</head>', '  <script src="/l99_auth.js"></script>\n</head>');
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(injected);
    return;
  }

  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
  res.end(readFileSync(filePath));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/ooda/incidents') {
    requestContext(req, res, () => requireAuth(req, res, () => openOodaStream(req, res)));
    return;
  }

  if (req.url.startsWith('/api/')) {
    router.handle(req, res);
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/story_engine.html';
  const filePath = join(__dirname, 'public', urlPath);

  if (existsSync(filePath)) {
    serveStatic(filePath, extname(filePath), res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120_000);
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 15_000);
server.keepAliveTimeout = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 5_000);

startOODALoop(db, 30_000, incidents => {
  console.log(`[OODA] Active incidents: ${incidents.length}`);
  broadcastIncidents(incidents);
});

startRuntimeScheduler(db, {
  scanIntervalMs: Number(process.env.RUNTIME_SCAN_INTERVAL_MS || 300000),
  drainIntervalMs: Number(process.env.RUNTIME_DRAIN_INTERVAL_MS || 15000)
});

server.listen(PORT, () => {
  const llmSnapshot = llmRoutingSnapshot();
  console.log(`L99 Story Engine running at http://localhost:${PORT}`);
  console.log('Security snapshot:', JSON.stringify(securitySnapshot()));
  console.log(`API body limit: ${API_MAX_BODY_BYTES} bytes`);
  console.log('LLM routing:', JSON.stringify(llmSnapshot));
  console.log(`LLM client started at: ${new Date(llmSnapshot.client_started_at).toISOString()} (${llmSnapshot.circuit_state_scope})`);
  console.log('L99 OS Alpha entry point: http://localhost:' + PORT + '/story_engine.html');
  console.log('OODA SSE: GET /api/ooda/incidents for authenticated live incidents.');
  console.log('Series Continuity Audit API: POST /api/audit/series-continuity');
  console.log('Creative Profiles: http://localhost:' + PORT + '/creative_profile.html');
  console.log('Control Room: http://localhost:' + PORT + '/control_room.html');
  console.log('Performance Dashboard: http://localhost:' + PORT + '/performance_dashboard.html');
  console.log('L99 Studio: http://localhost:' + PORT + '/studio.html');
  console.log('IP Studio: http://localhost:' + PORT + '/ip_studio.html');
  console.log('Campaign Studio: http://localhost:' + PORT + '/campaign_studio.html');
  console.log('Story Memory API: GET /api/memory/:workspace_id');
  console.log('Assist Mode: GET /api/assist/options');
  console.log('Audience lenses: GET /api/audience-lenses');
  console.log('Story Blueprint conversions: GET /api/blueprints/options');
  console.log('Validation Seed Assets: GET /api/validation-seeds/options');
  console.log('IP Growth Engine: GET /api/ip-growth/overview');
  console.log('IP Studio: GET /api/ip-studio/options');
  console.log('Campaign Studio: GET /api/campaign-studio/options');
  console.log('Founder Economics: GET /api/bootstrap-engine/overview');
  console.log('IP Seed Memory Graph: GET /api/ip-seeds/overview');
});
