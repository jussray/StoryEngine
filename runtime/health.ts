/**
 * Runtime liveness + readiness probes — l99-StoryEngine
 *
 * GET /health  — liveness (no deps)
 * GET /status  — readiness (checks schema registry + runtime state)
 *
 * Used by: Control Room uptime monitoring, CI smoke tests, deploy gates.
 */

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  timestamp: string;
  checks?: Array<{ name: string; status: 'ok' | 'down'; latencyMs?: number; detail?: string }>;
}

export function handleLiveness(): HealthResponse {
  return {
    status: 'ok',
    service: 'l99-story-engine',
    version: process.env.npm_package_version ?? '0.0.0',
    timestamp: new Date().toISOString(),
  };
}

export async function handleReadiness(schemaRegistryPath: string): Promise<[HealthResponse, number]> {
  const checks: HealthResponse['checks'] = [];

  // Schema registry check
  const schemaStart = Date.now();
  try {
    const fs = await import('fs/promises');
    await fs.access(schemaRegistryPath);
    checks.push({ name: 'schema-registry', status: 'ok', latencyMs: Date.now() - schemaStart });
  } catch {
    checks.push({ name: 'schema-registry', status: 'down', latencyMs: Date.now() - schemaStart, detail: `Cannot read ${schemaRegistryPath}` });
  }

  // Runtime state check
  const runtimeStart = Date.now();
  try {
    const { StoryEngine } = await import('./engine');
    const alive = await StoryEngine.ping();
    checks.push({ name: 'runtime', status: alive ? 'ok' : 'down', latencyMs: Date.now() - runtimeStart });
  } catch (e) {
    checks.push({ name: 'runtime', status: 'down', latencyMs: Date.now() - runtimeStart, detail: String(e) });
  }

  const allOk = checks.every(c => c.status === 'ok');
  const body: HealthResponse = {
    status: allOk ? 'ok' : 'degraded',
    service: 'l99-story-engine',
    version: process.env.npm_package_version ?? '0.0.0',
    timestamp: new Date().toISOString(),
    checks,
  };
  return [body, allOk ? 200 : 503];
}
