export const L99_VISION = Object.freeze({
  id: 'creator-continuity-provenance-runtime',
  stage: 'alpha',
  northStar: 'Help creators evolve durable intellectual property while preserving ownership, canon, provenance, isolation, recoverability, and human control.',
  source: 'docs/VISION.md'
});

export const L99_GUARDRAILS = Object.freeze([
  Object.freeze({ id: 'L99-ISOLATION-001', status: 'active', summary: 'Identity and tenant/workspace authorization resolve before semantic reuse.' }),
  Object.freeze({ id: 'L99-PROVENANCE-001', status: 'active', summary: 'Material outputs, events, and artifacts preserve source and lineage.' }),
  Object.freeze({ id: 'L99-REVOCATION-001', status: 'active', summary: 'Revocation outranks TTL and stale reuse.' }),
  Object.freeze({ id: 'L99-EVENT-001', status: 'active', summary: 'The event spine owns operational truth; dashboards are views.' }),
  Object.freeze({ id: 'L99-CANON-001', status: 'active', summary: 'Human-locked canon and authority cannot be silently overwritten by models.' }),
  Object.freeze({ id: 'L99-FRONTSTAGE-001', status: 'active', summary: 'Creator-facing pages remain separated from operator machinery and secrets.' }),
  Object.freeze({ id: 'L99-RELEASE-001', status: 'active', summary: 'Promotion requires validation evidence, release authority, and rollback.' }),
  Object.freeze({ id: 'L99-SECRET-001', status: 'active', summary: 'Provider, payment, notification, and operator credentials never appear in public responses.' })
]);

export function publicL99GuardrailSnapshot() {
  return Object.freeze({
    version: '1.0.0',
    vision: L99_VISION,
    guardrails: L99_GUARDRAILS,
    operationalTruth: 'event-spine',
    semanticSimilarityIsAuthorization: false,
    revocationPrecedence: 'revocation-before-ttl',
    creatorSeesOperatorSecrets: false
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] || character);
}

export function renderL99GuardrailPage() {
  const snapshot = publicL99GuardrailSnapshot();
  const items = snapshot.guardrails.map(item => `
    <li data-guardrail-id="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.id)}</strong>
      <span>${escapeHtml(item.status)}</span>
      <p>${escapeHtml(item.summary)}</p>
    </li>`).join('');

  return `<!doctype html>
<html lang="en" data-guardrails="active" data-product-stage="${escapeHtml(snapshot.vision.stage)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>L99 Guardrails</title>
  <style>body{font-family:system-ui,sans-serif;max-width:920px;margin:40px auto;padding:0 20px;background:#0a0d14;color:#edf4ff;line-height:1.5}article,section{background:#111827;border:1px solid #334155;border-radius:16px;padding:24px;margin:18px 0}li{margin:18px 0}span{color:#93c5fd;text-transform:uppercase;font-size:.78rem}code{color:#86efac}</style>
</head>
<body>
  <main>
    <h1>L99 guardrails</h1>
    <p data-testid="vision-stage">Stage: <strong>${escapeHtml(snapshot.vision.stage)}</strong></p>
    <article>
      <h2>North star</h2>
      <p>${escapeHtml(snapshot.vision.northStar)}</p>
    </article>
    <section>
      <h2>Runtime contract</h2>
      <ul>${items}</ul>
    </section>
    <p data-testid="truth-owner"><code>operationalTruth=${escapeHtml(snapshot.operationalTruth)}</code></p>
    <p data-testid="authorization-status"><code>semanticSimilarityIsAuthorization=false</code></p>
    <p data-testid="secret-status"><code>creatorSeesOperatorSecrets=false</code></p>
  </main>
</body>
</html>`;
}
