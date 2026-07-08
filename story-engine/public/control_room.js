const $ = id => document.getElementById(id);
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

let latest = null;
let source = null;

function tick() {
  $('clock').textContent = new Date().toLocaleTimeString();
}
tick();
setInterval(tick, 1000);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function statusClass(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('block') || text.includes('error') || text.includes('fail')) return 'red';
  if (text.includes('warn') || text.includes('watch') || text.includes('planned')) return 'gold';
  return 'green';
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function renderStats(data) {
  const memory = data.memory || {};
  const overview = data.overview || {};
  const currentConfidence = memory.confidence_trend?.at(-1)?.confidence_after
    ?? data.workspaces?.[0]?.confidence_score
    ?? 0;
  const gateStatus = data.workspaces?.some(item => item.release_gate_status === 'BLOCKED')
    ? 'BLOCKED'
    : data.workspaces?.some(item => item.release_gate_status === 'WARNING') ? 'WARNING' : 'READY';
  const runtimeStatus = overview.runtime_failures ? 'Degraded' : overview.running_dispatches ? 'Running' : 'Healthy';

  const cards = [
    ['Workspace Health', `${Math.round(currentConfidence || 0)}%`, currentConfidence >= 75 ? 'green' : 'gold', `${overview.workspaces || 0} workspaces`],
    ['Story Drift', memory.story_drift_count || 0, memory.story_drift_count ? 'red' : 'teal', 'Unresolved genome conflicts'],
    ['Engine Drift', memory.engine_drift_count || 0, memory.engine_drift_count ? 'purple' : 'green', 'Repeated mistakes today'],
    ['Runtime', runtimeStatus, statusClass(runtimeStatus), `${overview.queue_depth || 0} queued`],
    ['Confidence', `${Math.round(currentConfidence || 0)}%`, 'blue', 'Latest engine signal'],
    ['Lessons Today', memory.lessons_today || 0, 'gold', `${memory.repeated_mistake_count || 0} repeated`],
    ['Release Gate', gateStatus, statusClass(gateStatus), `${overview.release_gate_blocked_count || 0} blocked`],
    ['Active Incidents', overview.active_incidents || 0, overview.active_incidents ? 'red' : 'green', 'Across all workspaces']
  ];

  $('stats').innerHTML = cards.map(([label, value, cls, sub]) => `
    <article class="card">
      <div class="label">${esc(label)}</div>
      <div class="value ${cls}">${esc(value)}</div>
      <div class="sub">${esc(sub)}</div>
    </article>`).join('');
}

function renderFounder(data) {
  const founder = data.founder || {};
  const profile = founder.profile || {};
  $('founderName').value = profile.founder_name || 'Raylene';
  $('founderMode').value = profile.mode || 'bootstrap';
  $('monthlyBudget').value = Number(profile.monthly_budget || 0);
  $('recurringBudget').value = Number(profile.recurring_budget || 0);
  $('approvalThreshold').value = Number(profile.approval_threshold || 0);
  $('cashAvailable').value = Number(profile.cash_available || 0);
  $('monthlyRevenue').value = Number(profile.monthly_revenue || 0);
  $('preferFree').checked = profile.prefer_free !== false;
  $('requireRecurringApproval').checked = profile.require_recurring_approval !== false;
  $('founderNotes').value = profile.notes || '';
  $('founderStatus').textContent = `${String(profile.mode || 'bootstrap').toUpperCase()} · v${profile.version || 1}`;

  const cards = [
    ['Revenue', money(founder.monthly_revenue), founder.monthly_revenue > 0 ? 'green' : 'muted'],
    ['Spend', money(founder.monthly_spend), founder.monthly_spend > founder.monthly_revenue ? 'red' : 'teal'],
    ['Profit', money(founder.monthly_profit), founder.monthly_profit >= 0 ? 'green' : 'red'],
    ['Burn', money(founder.burn_rate), founder.burn_rate > 0 ? 'gold' : 'green'],
    ['Budget Left', money(founder.budget_remaining), founder.budget_remaining > 0 ? 'blue' : 'gold'],
    ['Runway', founder.runway == null ? '∞' : `${founder.runway.toFixed(1)} mo`, founder.runway == null || founder.runway >= 6 ? 'green' : 'gold']
  ];
  $('founderStats').innerHTML = cards.map(([label, value, cls]) => `
    <article class="card"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div></article>
  `).join('');
  $('founderRecommendation').textContent = founder.recommendation || 'Stay lean and ship.';
}

function incidentRows(data) {
  const memoryConflicts = (data.memory?.story_conflicts || []).map(item => ({
    kind: 'diff', id: item.id, title: `GENOME_DRIFT — ${item.entity_type}:${item.entity_id}`,
    meta: `${item.field}: ${item.old_value ?? '∅'} → ${item.new_value ?? '∅'}`,
    created_at: item.created_at
  }));
  const lindy = (data.incidents || []).map(item => ({
    kind: 'incident', id: item.incident_id, title: item.event_type || item.source || 'Lindymode incident',
    meta: item.summary || item.reason || '', created_at: item.created_at
  }));
  return [...memoryConflicts, ...lindy].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
}

function renderIncidents(data) {
  const rows = incidentRows(data);
  $('incidents').innerHTML = rows.length ? rows.map(item => `
    <div class="row">
      <div class="row-title">${esc(item.title)}</div>
      <div class="row-meta">${esc(item.meta)}${item.created_at ? ` · ${new Date(Number(item.created_at)).toLocaleString()}` : ''}</div>
      <div class="row-actions"><button class="btn resolve" data-kind="${item.kind}" data-id="${esc(item.id)}">Resolve</button></div>
    </div>`).join('') : '<div class="empty">No active incidents.</div>';

  document.querySelectorAll('.resolve').forEach(button => {
    button.addEventListener('click', () => {
      $('resolveType').value = button.dataset.kind;
      $('resolveId').value = button.dataset.id;
      $('resolution').value = '';
      $('resolveDialog').showModal();
    });
  });
}

function renderPipeline(data) {
  $('pipeline').innerHTML = (data.pipeline_health || []).map(item => `
    <div class="row"><div class="row-title">${esc(item.label)}</div><div class="row-meta ${statusClass(item.status)}">${esc(item.status)}</div></div>
  `).join('') || '<div class="empty">No pipeline data.</div>';
}

function renderWorkspaces(data) {
  $('workspaces').innerHTML = (data.workspaces || []).map(item => {
    const health = Math.max(0, Math.min(100, Number(item.confidence_score || 0)));
    const attempt = item.latest_release_attempt;
    return `<tr>
      <td><strong>${esc(item.title)}</strong></td>
      <td><div class="bar"><div class="fill" style="width:${health}%"></div></div><span class="sub">${health}%</span></td>
      <td>${item.chapter_count || 0}</td>
      <td class="${statusClass(item.release_gate_status)}">${esc(item.release_gate_status)}</td>
      <td>${esc(item.runtime_status)}</td>
      <td>${attempt ? `${esc(attempt.operation)} · ${esc(attempt.status)}` : '—'}</td>
      <td><a href="/story_home.html?workspace_id=${encodeURIComponent(item.workspace_id)}">Open</a></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty">No workspaces.</td></tr>';
}

function renderLessons(data) {
  const rows = data.memory?.recent_lessons || [];
  const flattened = rows.flatMap(row => row.lessons.map(lesson => ({ lesson, row })));
  $('lessons').innerHTML = flattened.length ? flattened.map(({ lesson, row }) => `
    <div class="row"><div class="row-title">${row.repeated_mistake ? '↩ ' : '✓ '}${esc(typeof lesson === 'string' ? lesson : JSON.stringify(lesson))}</div><div class="row-meta">${esc(row.workspace_id)} · ${new Date(Number(row.created_at)).toLocaleString()}</div></div>
  `).join('') : '<div class="empty">No lessons recorded today.</div>';
}

function renderConfidence(data) {
  const trend = data.memory?.confidence_trend || [];
  const values = trend.map(item => Number(item.confidence_after ?? item.confidence_before ?? 0));
  const current = values.at(-1) ?? 0;
  $('confidenceSummary').textContent = trend.length ? `Current ${Math.round(current)}% · ${trend.length} recent episodes` : 'No confidence history yet.';
  $('confidenceChart').innerHTML = values.length ? values.map(value => `<div class="chart-bar" title="${value}%" style="height:${Math.max(4, Math.min(100, value))}%"></div>`).join('') : '<div class="empty">No trend data.</div>';
}

function render(data) {
  latest = data;
  renderStats(data);
  renderFounder(data);
  renderIncidents(data);
  renderPipeline(data);
  renderWorkspaces(data);
  renderLessons(data);
  renderConfidence(data);
  $('updated').textContent = `Updated ${new Date(data.control_room_generated_at || data.generated_at).toLocaleString()}`;
}

async function load() {
  try {
    const data = await api('/api/control-room/overview');
    render(data);
    $('liveState').textContent = 'Live';
    $('liveState').className = 'pill green';
  } catch (error) {
    $('liveState').textContent = error.message;
    $('liveState').className = 'pill red';
  }
}

function connectStream() {
  source?.close();
  source = new EventSource('/api/control-room/stream');
  source.addEventListener('snapshot', event => {
    render(JSON.parse(event.data));
    $('liveState').textContent = 'Live';
    $('liveState').className = 'pill green';
  });
  source.addEventListener('error', () => {
    $('liveState').textContent = 'Reconnecting…';
    $('liveState').className = 'pill gold';
  });
}

$('refresh').addEventListener('click', load);
$('founderForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('founderStatus').textContent = 'Saving…';
  try {
    await api('/api/control-room/founder', {
      method: 'PUT',
      body: JSON.stringify({
        founder_name: $('founderName').value,
        mode: $('founderMode').value,
        monthly_budget: Number($('monthlyBudget').value || 0),
        recurring_budget: Number($('recurringBudget').value || 0),
        approval_threshold: Number($('approvalThreshold').value || 0),
        cash_available: Number($('cashAvailable').value || 0),
        monthly_revenue: Number($('monthlyRevenue').value || 0),
        prefer_free: $('preferFree').checked,
        require_recurring_approval: $('requireRecurringApproval').checked,
        notes: $('founderNotes').value
      })
    });
    await load();
    $('founderStatus').textContent = 'Saved';
  } catch (error) {
    $('founderStatus').textContent = error.message;
  }
});

$('confirmResolve').addEventListener('click', async event => {
  event.preventDefault();
  const kind = $('resolveType').value;
  const id = $('resolveId').value;
  const resolution = $('resolution').value.trim();
  if (!resolution) return;
  const body = kind === 'diff'
    ? { diff_id: Number(id), resolution }
    : { incident_id: id, resolution };
  try {
    await api('/api/control-room/resolve-incident', { method: 'POST', body: JSON.stringify(body) });
    $('resolveDialog').close();
    await load();
  } catch (error) {
    alert(error.message);
  }
});

load();
connectStream();
