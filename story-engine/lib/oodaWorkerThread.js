import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

import { collectActiveIncidents } from './oodaProcessor.js';

if (!parentPort) throw new Error('OODA worker requires a parent port.');

const db = new DatabaseSync(workerData.dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

parentPort.on('message', message => {
  if (message?.type === 'run') {
    try {
      parentPort.postMessage({
        type: 'incidents',
        run_id: message.run_id,
        incidents: collectActiveIncidents(db)
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        run_id: message.run_id,
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
