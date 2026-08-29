import { DurableObject } from 'cloudflare:workers';
import { buildContainerRuntimeEnv, CloudflareRuntimeConfigError } from './runtimeEnv.js';

const PRIMARY_INSTANCE_NAME = 'storyengine-primary';
const CONTAINER_PORT = 3000;
const READY_RETRIES = 40;
const READY_INTERVAL_MS = 250;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class StoryEngineContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }

  async ensureContainerReady(runtimeEnv) {
    if (!this.ctx.container.running) {
      this.ctx.container.start({
        env: runtimeEnv,
        enableInternet: true,
        entrypoint: ['node', 'server.js']
      });
    }

    const port = this.ctx.container.getTcpPort(CONTAINER_PORT);
    let lastFailure = null;

    for (let attempt = 0; attempt < READY_RETRIES; attempt += 1) {
      try {
        const probe = await port.fetch('http://container/healthz', {
          method: 'GET',
          headers: { 'x-storyengine-probe': 'cloudflare-container' }
        });
        if (probe.ok) return port;
        lastFailure = new Error(`health probe returned ${probe.status}`);
      } catch (error) {
        lastFailure = error;
      }

      if (!this.ctx.container.running) break;
      await delay(READY_INTERVAL_MS);
    }

    throw lastFailure || new Error('container did not become ready');
  }

  async fetch(request) {
    let runtimeEnv;
    try {
      runtimeEnv = buildContainerRuntimeEnv(this.env);
    } catch (error) {
      const reason = error instanceof CloudflareRuntimeConfigError
        ? error.code
        : 'runtime_configuration_invalid';
      return jsonResponse(503, {
        status: 'blocked',
        service: 'l99-story-engine',
        reason
      });
    }

    try {
      const port = await this.ensureContainerReady(runtimeEnv);
      return await port.fetch(request);
    } catch {
      return jsonResponse(502, {
        status: 'blocked',
        service: 'l99-story-engine',
        reason: 'container_not_ready'
      });
    }
  }
}

export default {
  fetch(request, env) {
    const id = env.STORYENGINE_CONTAINER.idFromName(PRIMARY_INSTANCE_NAME);
    return env.STORYENGINE_CONTAINER.get(id).fetch(request);
  }
};
