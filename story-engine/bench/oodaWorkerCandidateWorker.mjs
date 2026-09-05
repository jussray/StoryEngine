import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

import { computeMetrics } from '../lib/oodaProcessor.js';

const db = new DatabaseSync(workerData.dbPath);
db.exec('PRAGMA busy_timeout = 5000;');

parentPort.on('message', message => {
  if (message?.type === 'run') {
    const started = performance.now();
    try {
      const metrics = computeMetrics(db);
      parentPort.postMessage({
        type: 'result',
        id: message.id,
        elapsed_ms: performance.now() - started,
        metrics
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (message?.type === 'close') {
    db.close();
    parentPort.postMessage({ type: 'closed' });
  }
});
