import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

export function startOodaWorkerLoop(
  dbPath,
  intervalMs = 30_000,
  onIncidents = incidents => console.log('[OODA] Incidents:', incidents),
  onError = error => console.error('[OODA] Worker error:', error)
) {
  const worker = new Worker(new URL('./oodaWorkerThread.js', import.meta.url), {
    workerData: { dbPath }
  });
  let busy = false;
  let stopped = false;
  let interval = null;

  const reportError = error => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    onError(normalized);
  };

  const run = () => {
    if (stopped || busy) return false;
    busy = true;
    worker.postMessage({ type: 'run', run_id: randomUUID() });
    return true;
  };

  worker.on('message', message => {
    if (message?.type === 'incidents') {
      busy = false;
      onIncidents(Array.isArray(message.incidents) ? message.incidents : []);
      return;
    }
    if (message?.type === 'error') {
      busy = false;
      reportError(new Error(message.error || 'Unknown OODA worker failure.'));
    }
  });

  worker.on('error', error => {
    busy = false;
    reportError(error);
  });

  worker.on('exit', code => {
    busy = false;
    if (!stopped && code !== 0) {
      stopped = true;
      if (interval) clearInterval(interval);
      reportError(new Error(`OODA worker exited with code ${code}.`));
    }
  });

  run();
  interval = setInterval(run, intervalMs);

  return {
    run,
    isBusy: () => busy,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (interval) clearInterval(interval);
      await worker.terminate();
    }
  };
}
