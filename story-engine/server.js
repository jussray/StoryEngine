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

import storyRoutes from './routes/story.js';
import outlineRoutes from './routes/outline.js';
import chapterRoutes from './routes/chapters.js';
import movieRoutes from './routes/movie.js';
import eventsRoutes from './routes/events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

const router = createRouter();
storyRoutes(router, db);
outlineRoutes(router, db);
chapterRoutes(router, db);
movieRoutes(router, db);
eventsRoutes(router, db);

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    router.handle(req, res);
    return;
  }

  // Static file serving
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

// Start OODA loop — 30s interval, 15min rolling window
startOODALoop(db, 30_000, (incidents) => {
  console.log('[OODA] Active incidents:', JSON.stringify(incidents, null, 2));
});

server.listen(PORT, () => {
  console.log(`L99 Story Engine running at http://localhost:${PORT}`);
  console.log('No npm install needed. Node 22.5+ required.');
});
