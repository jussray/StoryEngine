const $ = id => document.getElementById(id);
let medium = 'book';
let assistMode = 'writer';
let currentRunId = null;
let pollTimer = null;

const ROLE_LABELS = {
  writer: 'Writer',
  co_writer: 'Co-Writer',
  director: 'Director',
  autonomous_studio: 'Autonomous Studio'
};

const START_LABELS = {
  writer: 'Start as Writer',
  co_writer: 'Start Co-Writing',
  director: 'Direct L99',
  autonomous_studio: 'Launch Autonomous Studio'
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function ensureUniverseLink(workspaceId) {
  if (!workspaceId) return;
  const links = document.querySelector('.links');
  if (!links) return;
  let link = document.getElementById('storyUniverseLink');
  if (!link) {
    link = document.createElement('a');
    link.id = 'storyUniverseLink';
    link.textContent = 'Story Universe';
    link.dataset.testid = 'story-universe-link';
    links.prepend(link);
  }
  link.href = `/story_universe.html?workspace_id=${encodeURIComponent(workspaceId)}`;
}

document.querySelectorAll('.type').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.type').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    medium = button.dataset.medium;
  });
});

document.querySelectorAll('.assist-option').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.assist-option').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    assistMode = button.dataset.assist;
    $('start').textContent = START_LABELS[assistMode];
  });
});

function renderRun(run) {
  currentRunId = run.run_id;
  ensureUniverseLink(run.workspace_id);
  $('runPanel').classList.remove('hidden');
  $('runTitle').textContent = run.intent?.title || 'L99 Pipeline Run';
  const role = run.assist_profile?.assist_mode;
  const assistLabel = role ? ROLE_LABELS[role] : null;
  $('runMeta').textContent = `${assistLabel ? `${assistLabel} · ` : ''}${run.active_agent} · ${run.current_stage}`;
  $('runStatus').textContent = run.status;
  $('approve').classList.toggle('hidden', run.status !== 'awaiting_approval');

  const byStage = new Map();
  for (const event of run.stages || []) byStage.set(event.stage, event);
  const stages = [
    'story_engine','intent_parser','creative_profile','ghost','lindymode','ooda',
    'redteam_pre_runtime','runtime','story_memory','learning_engine','playwright_validation',
    'redteam_pre_release','artifacts','release_gate','control_room','complete'
  ];
  const labels = {
    story_engine:'Story Engine',intent_parser:'Intent Parser',creative_profile:'Creative Profile',ghost:'Ghost',
    lindymode:'Lindymode',ooda:'OODA',redteam_pre_runtime:'Redteam — Pre-Runtime',runtime:'Runtime',
    story_memory:'Story Memory',learning_engine:'Learning Engine',playwright_validation:'Playwright',
    redteam_pre_release:'Redteam — Pre-Release',artifacts:'Artifact',release_gate:'Release Gate',
    control_room:'Control Room',complete:'Complete'
  };

  $('pipeline').innerHTML = stages.map(stage => {
    const event = byStage.get(stage);
    const status = event?.status || (stage === run.current_stage ? run.status : 'pending');
    let waiting = 'Waiting for its turn.';
    if (run.status === 'writer_active' && stage === 'story_engine') {
      waiting = 'You are writing. L99 stays advisory until you ask for support.';
    } else if (run.status === 'co_writer_ready' && stage === 'story_engine') {
      waiting = 'You and L99 share the workspace. Every proposed change still requires your acceptance.';
    }
    return `<div class="stage ${esc(status)}">
      <div class="dot"></div>
      <strong>${esc(labels[stage])}</strong>
      <div class="summary">${esc(event?.summary || waiting)}</div>
      <div class="agent">${esc(event?.agent || '')}</div>
    </div>`;
  }).join('');

  if (['complete', 'failed', 'needs_review', 'awaiting_approval', 'writer_active', 'co_writer_ready'].includes(run.status)) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshRun() {
  if (!currentRunId) return;
  try {
    const run = await api(`/api/story-engine/runs/${currentRunId}`);
    renderRun(run);
  } catch (error) {
    $('runMeta').textContent = error.message;
  }
}

async function loadDefaultAssistMode() {
  try {
    const settings = await api('/api/control-room/operator/assist-default');
    assistMode = settings.default_assist_mode || 'writer';
    document.querySelectorAll('.assist-option').forEach(item => {
      item.classList.toggle('active', item.dataset.assist === assistMode);
    });
    $('start').textContent = START_LABELS[assistMode] || START_LABELS.writer;
  } catch {
    assistMode = 'writer';
  }
}

$('storyForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('start').disabled = true;
  $('start').textContent = 'Starting…';
  try {
    const payload = {
      story_vision: $('vision').value.trim(),
      medium,
      audience: $('audience').value,
      story_kind: $('kind').value,
      emotional_effect: $('emotion').value,
      assist_mode: assistMode,
      estimated_cost: 0
    };
    const run = await api('/api/story-engine/runs', { method: 'POST', body: JSON.stringify(payload) });
    renderRun(run);
    if (!['complete', 'failed', 'needs_review', 'awaiting_approval', 'writer_active', 'co_writer_ready'].includes(run.status)) {
      clearInterval(pollTimer);
      pollTimer = setInterval(refreshRun, 3000);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    $('start').disabled = false;
    $('start').textContent = START_LABELS[assistMode] || START_LABELS.writer;
  }
});

$('approve').addEventListener('click', async () => {
  if (!currentRunId) return;
  $('approve').disabled = true;
  try {
    const run = await api(`/api/story-engine/runs/${currentRunId}/approve`, { method: 'POST', body: '{}' });
    renderRun(run);
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshRun, 3000);
  } catch (error) {
    alert(error.message);
  } finally {
    $('approve').disabled = false;
  }
});

const initialWorkspaceId = new URLSearchParams(window.location.search).get('workspace_id');
ensureUniverseLink(initialWorkspaceId);
loadDefaultAssistMode();
