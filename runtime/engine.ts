/**
 * StoryEngine — runtime entry point hardening
 *
 * Centralises:
 *  - Schema validation on startup (rejects malformed story graphs before execution)
 *  - Graceful shutdown signal handling
 *  - Ping method used by health checks
 *  - Error classification (user error vs system fault vs schema violation)
 */
import type { StoryGraph } from '../schemas/types';

export type EngineError =
  | { kind: 'schema_violation'; field: string; message: string }
  | { kind: 'runtime_fault'; code: string; message: string }
  | { kind: 'user_error'; message: string };

let _running = false;

export const StoryEngine = {
  /** Returns true if the engine runtime is reachable. Used by /status health check. */
  async ping(): Promise<boolean> {
    return _running;
  },

  /** Boot the engine with a validated story graph. */
  async start(graph: StoryGraph): Promise<void> {
    const errors = validateGraph(graph);
    if (errors.length > 0) {
      throw {
        kind: 'schema_violation',
        field: errors[0].field,
        message: errors[0].message,
      } satisfies EngineError;
    }
    _running = true;
    console.log(`[StoryEngine] Started — ${graph.id ?? 'unnamed'} (${graph.nodes?.length ?? 0} nodes)`);
  },

  /** Graceful shutdown. */
  async stop(): Promise<void> {
    _running = false;
    console.log('[StoryEngine] Stopped.');
  },
};

// Register OS signals for graceful shutdown
process.on('SIGTERM', () => StoryEngine.stop().then(() => process.exit(0)));
process.on('SIGINT', () => StoryEngine.stop().then(() => process.exit(0)));

// ---- Schema validation (lightweight, no external deps) ----

type ValidationError = { field: string; message: string };

function validateGraph(graph: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof graph !== 'object' || graph === null) {
    errors.push({ field: 'root', message: 'Story graph must be an object' });
    return errors;
  }
  const g = graph as Record<string, unknown>;
  if (!g.id || typeof g.id !== 'string') errors.push({ field: 'id', message: '`id` is required and must be a string' });
  if (!Array.isArray(g.nodes)) errors.push({ field: 'nodes', message: '`nodes` must be an array' });
  if (!Array.isArray(g.edges)) errors.push({ field: 'edges', message: '`edges` must be an array' });
  return errors;
}
