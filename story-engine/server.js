// server.js — L99 Story Engine
// Zero dependencies. Requires Node 22.5+ for node:sqlite.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import db from './config/db.js';
import { createRouter } from './lib/miniRouter.js';
import { startOODALoop } from './lib/oodaProcessor.js';
import { startRuntimeScheduler } from './lib/runtimeDispatcher.js';

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

const router = createRouter();
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

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/ooda/incidents') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    sendSse(res, 'heartbeat', { t: Date.now() });
    sendSse(res, 'incidents', latestIncidents);
    oodaClients.add(res);
    req.on('close', () => oodaClients.delete(res));
    return;
  }

  if (req.url.startsWith('/api/')) {
    router.handle(req, res);
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/front_door.html';
  const filePath = join(__dirname, 'public', urlPath);

  if (existsSync(filePath)) {
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

startOODALoop(db, 30_000, incidents => {
  console.log(`[OODA] Active incidents: ${incidents.length}`);
  broadcastIncidents(incidents);
});

startRuntimeScheduler(db, {
  scanIntervalMs: Number(process.env.RUNTIME_SCAN_INTERVAL_MS || 300000),
  drainIntervalMs: Number(process.env.RUNTIME_DRAIN_INTERVAL_MS || 15000)
});

server.listen(PORT, () => {
  console.log(`L99 Story Engine running at http://localhost:${PORT}`);
  console.log('OODA SSE: GET /api/ooda/incidents for live incidents.');
  console.log('Control Room: http://localhost:' + PORT + '/control_room.html');
  console.log('Performance Dashboard: http://localhost:' + PORT + '/performance_dashboard.html');
  console.log('L99 Studio: http://localhost:' + PORT + '/studio.html');
  console.log('Story Memory API: GET /api/memory/:workspace_id');
  console.log('Mission Control, Studio, Memory Engine, Performance Dashboard, retention, Release Gate, Release Attempts, Control Room, and runtime scheduler registered.');
});
