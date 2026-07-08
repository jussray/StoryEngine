const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const pct = value => `${(Number(value || 0) * 100).toFixed(1)}%`;
const ms = value => `${Math.round(Number(value || 0))}ms`;

let source;

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed ${response.status}`);
  return data;
}

function color(status) {
  if (status === 'critical' || status === 'BLOCKED') return 'bad';
  if (status === 'warning' || status === 'WARNING') return 'warn';
  return 'ok';
}

function renderStats(data) {
  const o = data.overview || {};
  const cards = [
    ['Workspaces', o.workspaces || 0, 'teal', 'with events in window'],
    ['Total Events', o.total_events || 0, 'blue', `${Math.round(data.window_ms / 60000)}m window`],
    ['Max p99', ms(o.max_p99), o.max_p99 > 1000 ? 'warn' : 'ok', 'slowest workspace'],
    ['Rollback', pct(o.rollback_rate), o.rollback_rate > .02 ? 'bad' : 'ok', 'all workspaces'],
    ['Error Rate', pct(o.error_rate), o.error_rate > .05 ? 'bad' : 'ok', 'failed/blocked/error events'],
    ['Incidents', o.active_incidents || 0, o.active_incidents ? 'bad' : 'ok', 'active OODA signals'],
    ['Gate Blocked', o.gate_blocked || 0, o.gate_blocked ? 'bad' : 'ok', 'release pressure'],
    ['Gate Warning', o.gate_warning || 0, o.gate_warning ? 'warn' : 'ok', 'release pressure']
  ];
  $('stats').innerHTML = cards.map(([label, value, cls, sub]) => `<article class="card"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div><div class="sub">${esc(sub)}</div></article>`).join('');
}

function renderWorkspaces(data) {
  $('workspaces').innerHTML = (data.workspace_metrics || []).map(item => `<tr>
    <td><strong>${esc(item.title)}</strong><div class="sub">${esc(item.workspace_id)}</div></td>
    <td class="${color(item.status)}">${esc(item.status)}</td>
    <td>${item.total_events}</td>
    <td>${ms(item.p50)}</td>
    <td>${ms(item.p99)}</td>
    <td>${item.p99_ratio}</td>
    <td>${pct(item.error_rate)}</td>
    <td>${pct(item.rollback_rate)}</td>
  </tr>`).join('') || '<tr><td colspan="8" class="sub">No events in the selected window.</td></tr>';
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

function render(data) {
  renderStats(data);
  renderWorkspaces(data);
  renderEndpoints(data);
  renderIncidents(data);
  renderEvents(data);
  $('updated').textContent = `Updated ${new Date(data.generated_at).toLocaleString()}`;
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
load();
connect();
