const workspaceIdEl = document.getElementById('workspaceId');
const statusEl = document.getElementById('status');
const panelEl = document.getElementById('decisionPanel');
const actionEl = document.getElementById('decisionAction');
const readinessEl = document.getElementById('decisionReadiness');
const confidenceEl = document.getElementById('confidenceScore');
const incidentCountEl = document.getElementById('incidentCount');
const reasonsListEl = document.getElementById('reasonsList');
const recoveryPlanEl = document.getElementById('recoveryPlan');
const releaseResultEl = document.getElementById('releaseResult');
const releaseChecksEl = document.getElementById('releaseChecks');

function workspaceId() {
  return workspaceIdEl.value.trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.payload = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function stateClass(value) {
  if (['BLOCK', 'UNSAFE', 'BLOCKED'].includes(value)) return 'health-text-critical';
  if (['RECOVER', 'INTERVENE', 'NEEDS_REVIEW'].includes(value)) return 'health-text-watch';
  return 'health-text-good';
}

function renderDecision(decision) {
  panelEl.classList.remove('hidden');
  actionEl.textContent = decision.action;
  readinessEl.textContent = decision.readiness.replaceAll('_', ' ');
  confidenceEl.textContent = `${decision.confidence_score}%`;
  incidentCountEl.textContent = String(decision.evidence?.active_incidents || 0);
  actionEl.className = stateClass(decision.action);
  readinessEl.className = stateClass(decision.readiness);

  reasonsListEl.innerHTML = decision.reasons.length
    ? `<ul class="finding-list">${decision.reasons.map(reason => `<li><strong>${escapeHtml(reason.code.replaceAll('_', ' '))}</strong><span>${escapeHtml(reason.message)}</span></li>`).join('')}</ul>`
    : '<p class="subtitle">No active decision reasons. Workspace is healthy.</p>';

  recoveryPlanEl.innerHTML = decision.recovery_plan.length
    ? decision.recovery_plan.map(step => `<li><span>${escapeHtml(step)}</span></li>`).join('')
    : '<li><span>No recovery actions required.</span></li>';
}

async function evaluateWorkspace() {
  const id = workspaceId();
  if (!id) return;
  statusEl.textContent = 'Evaluating workspace…';
  try {
    const decision = await request(`/api/ooda/decision/${encodeURIComponent(id)}`);
    renderDecision(decision);
    statusEl.textContent = `Evaluated at ${new Date(decision.generated_at).toLocaleString()}.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function persistDecision() {
  const id = workspaceId();
  if (!id) return;
  statusEl.textContent = 'Recording decision…';
  try {
    const decision = await request(`/api/ooda/decision/${encodeURIComponent(id)}`, { method: 'POST', body: '{}' });
    renderDecision(decision);
    statusEl.textContent = `Decision recorded: ${decision.decision_id}`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

function renderAudit(audit) {
  releaseResultEl.textContent = audit.result;
  releaseResultEl.className = stateClass(audit.result);
  releaseChecksEl.innerHTML = audit.checks.map(check => `
    <div class="release-check ${check.passed ? 'release-check-pass' : 'release-check-fail'}">
      <strong>${check.passed ? 'PASS' : 'BLOCK'}</strong>
      <span>${escapeHtml(check.name.replaceAll('_', ' '))}</span>
    </div>
  `).join('');
}

async function runReleaseAudit() {
  const id = workspaceId();
  if (!id) return;
  releaseResultEl.textContent = 'Running…';
  try {
    const response = await fetch(`/api/ooda/release-audit/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const audit = await response.json();
    if (!response.ok && response.status !== 409) throw new Error(audit.error || 'Release audit failed.');
    renderAudit(audit);
    renderDecision(audit.decision);
  } catch (error) {
    releaseResultEl.textContent = 'Error';
    releaseResultEl.className = 'health-text-critical';
    releaseChecksEl.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

document.getElementById('evaluateBtn').addEventListener('click', evaluateWorkspace);
document.getElementById('persistDecision').addEventListener('click', persistDecision);
document.getElementById('runReleaseAudit').addEventListener('click', runReleaseAudit);

const initialWorkspace = new URLSearchParams(window.location.search).get('workspace_id');
if (initialWorkspace) {
  workspaceIdEl.value = initialWorkspace;
  evaluateWorkspace();
}
