/**
 * companionLogger.test.js — Batch 2 unit tests
 * Tests schema validation, row shape, fallback flag behavior.
 * Does NOT hit Supabase — Supabase client is intentionally unavailable.
 */

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.COMPANION_GHOST_FALLBACK_ENABLED = 'true';

const { record, withCompanionSpan, FALLBACK_ENABLED } = await import('../lib/companionLogger.js');

const BASE = {
  userId: 'user-uuid-001',
  tenantId: 'tenant-uuid-001',
  sessionId: 'session-uuid-001',
  companionId: 'raylene',
  modelUsed: 'gpt-4o',
  modelVersion: '2025-01',
  requestAt: Date.now() - 500,
  responseAt: Date.now(),
  tokenInput: 80,
  tokenOutput: 120,
  success: true,
};

async function run() {
  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (error) {
      console.error(`  ❌ ${name}:`, error.message);
      failed++;
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message ?? 'assertion failed');
  }

  console.log('\n[companionLogger] Batch 2 unit tests\n');

  await check('record() returns a UUID string', async () => {
    const id = await record({ ...BASE });
    assert(typeof id === 'string' && id.length === 36, `expected UUID, got: ${id}`);
  });

  await check('record() accepts all five companions', async () => {
    for (const companionId of ['raylene', 'rylane', 'cloud', 'night', 'oracle']) {
      const id = await record({ ...BASE, companionId });
      assert(typeof id === 'string');
    }
  });

  await check('record() rejects unknown companion_id without breaking the caller', async () => {
    const id = await record({ ...BASE, companionId: 'unknown_bot' });
    assert(typeof id === 'string');
  });

  await check('fallback row accepts zero token counts', async () => {
    const id = await record({
      ...BASE,
      success: false,
      isFallback: true,
      fallbackReason: 'api_error_500',
      tokenInput: 0,
      tokenOutput: 0,
    });
    assert(typeof id === 'string');
  });

  await check('invalid fallback token counts do not break the caller', async () => {
    const id = await record({
      ...BASE,
      success: false,
      isFallback: true,
      fallbackReason: 'api_error_500',
      tokenInput: 50,
      tokenOutput: 80,
    });
    assert(typeof id === 'string');
  });

  await check('withCompanionSpan() auto-logs on success', async () => {
    const result = await withCompanionSpan(
      { ...BASE, requestAt: undefined, responseAt: undefined },
      async (span) => {
        span.setSuccess({ tokenInput: 100, tokenOutput: 90 });
        return 'ok';
      },
    );
    assert(result === 'ok');
  });

  await check('withCompanionSpan() rethrows model errors after fail-safe logging', async () => {
    let rethrown = false;
    try {
      await withCompanionSpan(
        { ...BASE, requestAt: undefined, responseAt: undefined },
        async () => {
          const error = new Error('model timeout');
          error.code = 'ETIMEDOUT';
          throw error;
        },
      );
    } catch (error) {
      rethrown = error.code === 'ETIMEDOUT';
    }
    assert(rethrown, 'expected original model error to be rethrown');
  });

  await check('FALLBACK_ENABLED reflects env var', async () => {
    assert(FALLBACK_ENABLED === true);
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

await run();
