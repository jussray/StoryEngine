const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const pct = value => `${(Number(value || 0) * 100).toFixed(1)}%`;
const ms = value => value == null ? '—' : `${Math.round(Number(value))}ms`;

let source;

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed ${response.status}`);
  return data;
}

function color(status) {
  if (status === 'critical' || status === 'BLOCKED') return 'bad';
  if (status === 'warning' || status === 'WARNING' || status === 'unknown' || status === 'UNKNOWN') return 'warn';
  return 'ok';
}

function renderStats(data) {
  const o = data.overview || {};
  const hasLatency = Number(o.latency_samples || 0) > 0 && o.max_p99 != null;
  const cards = [
    ['Workspaces', o.workspaces || 0, 'teal', 'with events in window'],
    ['Total Events', o.total_events || 0, 'blue', `${Math.round(data.window_ms / 60000)}m window`],
    ['Max p99', hasLatency ? ms(o.max_p99) : 'Unknown', hasLatency ? (o.max_p99 > 1000 ? 'warn' : 'ok') : 'warn', hasLatency ? 'slowest workspace' : 'no latency samples'],
    ['Rollback', pct(o.rollback_rate), o.rollback_rate > .02 ? 'bad' : 'ok', 'all workspaces'],
    ['Error Rate', pct(o.error_rate), o.error_rate > .05 ? 'bad' : 'ok', 'failed/blocked/error events'],
    ['Incidents', o.active_incidents || 0, o.active_incidents ? 'bad' : 'ok', 'active OODA signals'],
    ['Gate Blocked', o.gate_blocked || 0, o.gate_blocked ? 'bad' : 'ok', 'release pressure'],
    ['Gate Warning', o.gate_warning || 0, o.gate_warning ? 'warn' : 'ok', 'release pressure']
  ];
  $('stats').innerHTML = cards.map(([label, value, cls, sub]) => `<article class="card"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div><div class="sub">${esc(sub)}</div></article>`).join('');
}

function renderWorkspaces(data) {
  $('workspaces').innerHTML = (data.workspace_metrics || []).map(item => {
    const hasLatency = Number(item.latency_sample_count || 0) > 0;
    return `<tr>
    <td><strong>${esc(item.title)}</strong><div class="sub">${esc(item.workspace_id)}</div></td>
    <td class="${color(item.status)}">${esc(item.status)}</td>
    <td>${item.total_events}</td>
    <td>${hasLatency ? ms(item.p50) : '—'}</td>
    <td>${hasLatency ? ms(item.p99) : '—'}</td>
    <td>${hasLatency ? item.p99_ratio : '—'}</td>
    <td>${pct(item.error_rate)}</td>
    <td>${pct(item.rollback_rate)}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="8" class="sub">No events in the selected window.</td></tr>';
}

function renderEndpoints(data) {
  $('endpoints').innerHTML = (data.endpoint_metrics || []).map(item => `<div class="row"><div class="row-title">${esc(item.workspace_id)} · ${esc(item.mode || 'application')}</div><div class="row-meta">events ${item.total_events} · p50 ${ms(item.p50)} · p95 ${ms(item.p95)} · p99 ${ms(item.p99)} · rollback ${pct(item.rollback_rate)}</div></div>`).join('') || '<div class="row sub">No endpoint metrics.</div>';
}

function renderIncidents(data) {
  const incidents = (data.incidents || []).map(item => `<div class="row"><div class="row-title ${color(item.severity === 'critical' ? 'critical' : 'warning')}">${esc(item.event_type || item.source)}</div><div class="row-meta">${esc(item.workspace_id)} · ${esc(item.summary)}</div></div>`).join('');
  const gate = data.gate_pressure || {};
  const gates = (gate.gates || []).filter(item => item.status !== 'READY').map(item => `<div class="row"><div class="row-title ${color(item.status)}">Release Gate ${esc(item.status)}</div><div class="row-meta">${esc(item.workspace_id)} · ${esc((item.blockers || item.warnings || [])[0] || 'review required')}</div></div>`).join('');
  $('incidents').innerHTML = incidents + gates || '<div class="row sub">No active incidents or gate pressure.</div>';
}

function renderEvents(data) {
  $('events').innerHTML = (data.recent_events || []).map(item => `<div class="row"><div class="row-title">${esc(item.event_type)}</div><div class="row-meta">${esc(item.workspace_id)} · ${esc(item.mode || 'application')} · ${item.duration_ms == null ? '—' : ms(item.duration_ms)} · rollback ${item.rollback ? 'yes' : 'no'} · ${new Date(Number(item.created_at)).toLocaleString()}</div></div>`).join('') || '<div class="row sub">No events.</div>';
}

function renderBusiness(data) {
  const metrics = data.metrics || [];
  $('businessSummary').innerHTML = metrics.map(item => {
    const identity = [item.source, item.account_id, item.page_id, item.audience_segment].filter(Boolean).join(' · ');
    return `<span class="metric-chip">${esc(item.metric_name)} · ${esc(item.observations)} obs · ${esc(item.missing)} missing · ${esc(item.unit)}${identity ? ` · ${esc(identity)}` : ''}</span>`;
  }).join('');
  $('businessRows').innerHTML = (data.observations || []).map(item => {
    const value = item.value_state === 'missing' ? '<span class="warn">Missing</span>' : esc(item.metric_value);
    const provenance = item.provenance || {};
    return `<tr>
      <td>${esc(new Date(Number(item.observed_at)).toLocaleString())}${item.historical ? '<div class="sub">historical import</div>' : ''}</td>
      <td><strong>${esc(item.metric_name)}</strong><div class="sub">${esc(item.content_id || '')}</div><div class="sub">${esc(item.condition || 'context')}${item.measurement_window_hours == null ? '' : ` · ${esc(item.measurement_window_hours)}h`}</div></td>
      <td>${value}</td>
      <td>${esc(item.unit)}</td>
      <td>${esc(item.audience_segment || 'Unknown')}</td>
      <td>${esc(item.source)}</td>
      <td>${esc(item.account_id)}${item.page_id ? `<div class="sub">${esc(item.page_id)}</div>` : ''}</td>
      <td>${esc(provenance.connector || provenance.import_format || 'recorded')}<div class="sub">${esc(provenance.import_receipt || provenance.line_number || '')}</div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="sub">No business evidence recorded for this workspace.</td></tr>';
  $('businessStatus').textContent = `${(data.observations || []).length} observations`;
  $('businessStatus').className = 'pill ok';
}

function render(data) {
  renderStats(data);
  renderWorkspaces(data);
  renderEndpoints(data);
  renderIncidents(data);
  renderEvents(data);
  $('updated').textContent = `Updated ${new Date(data.generated_at).toLocaleString()}`;
}

function businessInputs() {
  return {
    workspace: $('metricWorkspace').value.trim(),
    source: $('metricSource').value.trim(),
    account: $('metricAccount').value.trim(),
    page: $('metricPage').value.trim(),
    audience: $('metricAudience').value.trim()
  };
}

async function loadBusinessEvidence() {
  const { workspace } = businessInputs();
  if (!workspace) throw new Error('Workspace ID is required.');
  $('businessStatus').textContent = 'Loading…';
  $('businessStatus').className = 'pill warn';
  const data = await api(`/api/performance/business/${encodeURIComponent(workspace)}?limit=100`);
  renderBusiness(data);
  return data;
}

async function importBusinessEvidence() {
  const input = businessInputs();
  const file = $('metricFile').files?.[0];
  if (!input.workspace) throw new Error('Workspace ID is required.');
  if (!input.source) throw new Error('Source is required.');
  if (!input.account) throw new Error('Account ID is required.');
  if (!file) throw new Error('Choose a CSV evidence file.');

  const params = new URLSearchParams({
    source: input.source,
    account_id: input.account
  });
  if (input.page) params.set('page_id', input.page);
  if (input.audience) params.set('audience_segment', input.audience);

  $('importBusiness').disabled = true;
  $('businessReceipt').textContent = 'Importing evidence…';
  try {
    const receipt = await api(`/api/performance/business/${encodeURIComponent(input.workspace)}/import?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: await file.text()
    });
    $('businessReceipt').textContent = `Import receipt: ${receipt.written} written, ${receipt.duplicates} duplicates, ${receipt.missing_values} missing values.`;
    await loadBusinessEvidence();
  } finally {
    $('importBusiness').disabled = false;
  }
}

async function load() {
  try {
    const data = await api('/api/performance/overview');
    render(data);
    $('live').textContent = 'Live';
    $('live').className = 'pill ok';
  } catch (error) {
    $('live').textContent = error.message;
    $('live').className = 'pill bad';
  }
}

function connect() {
  source?.close();
  source = new EventSource('/api/performance/stream');
  source.addEventListener('performance', event => {
    render(JSON.parse(event.data));
    $('live').textContent = 'Live';
    $('live').className = 'pill ok';
  });
  source.addEventListener('error', () => {
    $('live').textContent = 'Reconnecting…';
    $('live').className = 'pill warn';
  });
}

$('refresh').addEventListener('click', load);
$('loadBusiness').addEventListener('click', async () => {
  try {
    $('businessReceipt').textContent = '';
    await loadBusinessEvidence();
  } catch (error) {
    $('businessStatus').textContent = 'Evidence unavailable';
    $('businessStatus').className = 'pill bad';
    $('businessReceipt').textContent = error.message;
  }
});
$('importBusiness').addEventListener('click', async () => {
  try {
    await importBusinessEvidence();
  } catch (error) {
    $('businessStatus').textContent = 'Import failed';
    $('businessStatus').className = 'pill bad';
    $('businessReceipt').textContent = error.message;
  }
});

load();
connect();
