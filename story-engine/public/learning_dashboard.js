const workspaceIdEl = document.getElementById('workspaceId');
const statusEl = document.getElementById('status');
const panelEl = document.getElementById('predictionPanel');
const riskEl = document.getElementById('predictedRisk');
const confidenceEl = document.getElementById('predictionConfidence');
const confidenceTrendEl = document.getElementById('confidenceTrend');
const likelyActionEl = document.getElementById('likelyAction');
const signalListEl = document.getElementById('signalList');
const episodeListEl = document.getElementById('episodeList');
const recoveryListEl = document.getElementById('recoveryList');

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
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function riskClass(risk) {
  if (risk === 'CRITICAL') return 'health-text-critical';
  if (risk === 'HIGH' || risk === 'MEDIUM') return 'health-text-watch';
  return 'health-text-good';
}

function formatDate(value) {
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function renderPrediction(prediction) {
  panelEl.classList.remove('hidden');
  riskEl.textContent = prediction.predicted_risk;
  riskEl.className = riskClass(prediction.predicted_risk);
  confidenceEl.textContent = `${prediction.confidence_score}%`;
  confidenceTrendEl.textContent = `${prediction.confidence_trend > 0 ? '+' : ''}${prediction.confidence_trend}`;
  likelyActionEl.textContent = prediction.likely_next_action;
  likelyActionEl.className = riskClass(prediction.predicted_risk);

  signalListEl.innerHTML = prediction.signals.map(signal => `
    <li><span>${escapeHtml(signal)}</span></li>
  `).join('');
}

function renderEpisodes(episodes) {
  if (!episodes.length) {
    episodeListEl.innerHTML = '<p class="subtitle">No episodes recorded yet. Recover a Lindymode incident to create one.</p>';
    return;
  }

  episodeListEl.innerHTML = episodes.map(episode => `
    <article class="beat-card incident-card">
      <div class="workspace-card-topline">
        <span class="health-pill ${episode.outcome === 'success' ? 'health-good' : episode.outcome === 'failed' ? 'health-critical' : 'health-watch'}">${escapeHtml(episode.outcome)}</span>
        <span class="workspace-date">${escapeHtml(formatDate(episode.created_at))}</span>
      </div>
      <strong>${escapeHtml(episode.trigger_type)}</strong>
      <p>${escapeHtml(episode.recovery_action || 'No recovery action recorded.')}</p>
      <p class="subtitle">Confidence ${escapeHtml(episode.confidence_before ?? '—')} → ${escapeHtml(episode.confidence_after ?? '—')}</p>
    </article>
  `).join('');
}

function renderRecoveries(recoveries) {
  if (!recoveries.length) {
    recoveryListEl.innerHTML = '<p class="subtitle">No learned recovery patterns yet.</p>';
    return;
  }

  recoveryListEl.innerHTML = recoveries.map(item => `
    <div class="timeline-item timeline-event">
      <span class="timeline-dot"></span>
      <div>
        <strong>${escapeHtml(item.recovery_action)}</strong>
        <small>${escapeHtml(item.trigger_type)} · ${item.uses} use${item.uses === 1 ? '' : 's'}</small>
        <p>Average confidence gain: ${item.avg_gain > 0 ? '+' : ''}${item.avg_gain}</p>
      </div>
    </div>
  `).join('');
}

async function runPrediction() {
  const id = workspaceId();
  if (!id) return;
  statusEl.textContent = 'Running predictive OODA…';

  try {
    const [prediction, episodes, recoveries] = await Promise.all([
      request(`/api/ooda/predict/${encodeURIComponent(id)}`, { method: 'POST', body: '{}' }),
      request(`/api/ooda/episodes/${encodeURIComponent(id)}?limit=50`),
      request('/api/ooda/learned-recoveries?limit=20')
    ]);

    renderPrediction(prediction);
    renderEpisodes(episodes);
    renderRecoveries(recoveries);
    statusEl.textContent = `Prediction generated at ${new Date(prediction.generated_at).toLocaleString()}.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

document.getElementById('runPrediction').addEventListener('click', runPrediction);

const initialWorkspace = new URLSearchParams(window.location.search).get('workspace_id');
if (initialWorkspace) {
  workspaceIdEl.value = initialWorkspace;
  runPrediction();
}
