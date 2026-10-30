const $ = id => document.getElementById(id);
let medium = 'book';
let assistMode = 'writer';
let currentRunId = null;
let pollTimer = null;

const ROLE_LABELS = {
  writer: 'I’ll write it',
  co_writer: 'Create with me',
  director: 'Draft it for me',
  autonomous_studio: 'Build the first version'
};

const START_LABELS = {
  writer: 'Start writing',
  co_writer: 'Start creating together',
  director: 'Draft a first version',
  autonomous_studio: 'Build the first version'
};

const STAGE_LABELS = {
  story_engine: 'Creative workspace',
  intent_parser: 'Understanding your idea',
  creative_profile: 'Creative direction',
  ghost: 'Drafting',
  lindymode: 'Voice & style',
  ooda: 'Continuity check',
  redteam_pre_runtime: 'Story challenge',
  runtime: 'Building the work',
  story_memory: 'Remembering the world',
  learning_engine: 'Learning from changes',
  playwright_validation: 'Preview check',
  redteam_pre_release: 'Final story review',
  artifacts: 'Packaging the work',
  release_gate: 'Ready-to-release check',
  control_room: 'Project status',
  complete: 'Complete'
};

const TERMINAL_RUN_STATUSES = new Set([
  'complete', 'failed', 'needs_review', 'awaiting_approval', 'writer_active', 'co_writer_ready'
]);

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

function creatorCopy(value) {
  return String(value || '')
    .replaceAll('L99', 'StoryEngine')
    .replaceAll('pipeline', 'project flow')
    .replaceAll('Pipeline', 'Project flow');
}

function enterStudioMode() {
  document.body.classList.add('has-run');
  $('creationCard')?.classList.add('hidden');
  if ($('studioHeroTitle')) $('studioHeroTitle').textContent = 'Your story is taking shape.';
  if ($('studioHeroCopy')) {
    $('studioHeroCopy').textContent = 'Keep the original idea close, review what changes, and move toward release when the work feels right.';
  }
}

function ensureUniverseLink(workspaceId) {
  if (!workspaceId) return;
  const links = document.querySelector('.links');
  if (!links) return;
  let link = document.getElementById('storyUniverseLink');
  if (!link) {
    link = document.createElement('a');
    link.id = 'storyUniverseLink';
    link.textContent = 'Story World';
    link.dataset.testid = 'story-universe-link';
    links.prepend(link);
  }
  link.href = `/story_universe.html?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function ensureArtifactLink(artifact) {
  const artifactId = artifact?.artifact_id;
  const runHead = document.querySelector('.run-head > div:last-child');
  if (!runHead) return;
  let link = document.getElementById('storyArtifactLink');
  if (!artifactId) {
    if (link) link.classList.add('hidden');
    return;
  }
  if (!link) {
    link = document.createElement('a');
    link.id = 'storyArtifactLink';
    link.className = 'btn';
    link.dataset.testid = 'story-artifact-link';
    link.textContent = 'Open output';
    link.target = '_blank';
    link.rel = 'noopener';
    runHead.append(' ', link);
  }
  link.href = `/api/artifacts/${encodeURIComponent(artifactId)}/html`;
  link.classList.remove('hidden');
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

function shouldPoll(run) {
  return !TERMINAL_RUN_STATUSES.has(run.status);
}

function renderRun(run) {
  currentRunId = run.run_id;
  enterStudioMode();
  ensureUniverseLink(run.workspace_id);
  ensureArtifactLink(run.artifact);
  $('runPanel').classList.remove('hidden');
  $('runTitle').textContent = run.intent?.title || 'Story in progress';
  const role = run.assist_profile?.assist_mode;
  const assistLabel = role ? ROLE_LABELS[role] : null;
  const stageLabel = STAGE_LABELS[run.current_stage] || 'In progress';
  $('runMeta').textContent = `${assistLabel ? `${assistLabel} · ` : ''}${stageLabel}`;
  // Keep the raw status value in this stable DOM contract for existing proof consumers.
  $('runStatus').textContent = run.status;
  $('approve').classList.toggle('hidden', run.status !== 'awaiting_approval');

  const byStage = new Map();
  for (const event of run.stages || []) byStage.set(event.stage, event);
  const stages = [
    'story_engine','intent_parser','creative_profile','ghost','lindymode','ooda',
    'redteam_pre_runtime','runtime','story_memory','learning_engine','playwright_validation',
    'redteam_pre_release','artifacts','release_gate','control_room','complete'
  ];

  $('pipeline').innerHTML = stages.map(stage => {
    const event = byStage.get(stage);
    const status = event?.status || (stage === run.current_stage ? run.status : 'pending');
    let waiting = 'Waiting for its turn.';
    if (run.status === 'writer_active' && stage === 'story_engine') {
      waiting = 'Your canvas is ready. StoryEngine stays supportive until you ask for help.';
    } else if (run.status === 'co_writer_ready' && stage === 'story_engine') {
      waiting = 'Your shared creative workspace is ready. You decide what becomes part of the work.';
    }
    return `<div class="stage ${esc(status)}">
      <div class="dot"></div>
      <strong>${esc(STAGE_LABELS[stage] || stage)}</strong>
      <div class="summary">${esc(creatorCopy(event?.summary || waiting))}</div>
      <div class="agent"></div>
    </div>`;
  }).join('');

  if (!shouldPoll(run)) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function advanceRun(run) {
  let current = run;
  if (shouldPoll(current)) {
    current = await api(`/api/story-engine/runs/${encodeURIComponent(current.run_id)}/resume`, {
      method: 'POST',
      body: '{}'
    });
  }

  const artifact = current.artifact;
  const routeProofNeeded = current.status === 'needs_review'
    && artifact?.artifact_id
    && artifact?.validation?.requires_real_route === true;
  if (routeProofNeeded) {
    const validated = await api(`/api/artifacts/${encodeURIComponent(artifact.artifact_id)}/validate`, {
      method: 'POST',
      body: '{}'
    });
    if (validated.validation?.passed === true && validated.validation?.real_route_proof === true) {
      current = await api(`/api/story-engine/runs/${encodeURIComponent(current.run_id)}/resume`, {
        method: 'POST',
        body: '{}'
      });
    } else {
      current = {
        ...current,
        artifact: {
          ...artifact,
          status: validated.status,
          validation: validated.validation
        }
      };
    }
  }
  return current;
}

async function refreshRun() {
  if (!currentRunId) return null;
  try {
    const loaded = await api(`/api/story-engine/runs/${encodeURIComponent(currentRunId)}`);
    const run = await advanceRun(loaded);
    renderRun(run);
    return run;
  } catch (error) {
    enterStudioMode();
    $('runPanel').classList.remove('hidden');
    $('runMeta').textContent = creatorCopy(error.message);
    return null;
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshRun, 3000);
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
  $('start').textContent = 'Opening studio…';
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
    if (shouldPoll(run)) startPolling();
  } catch (error) {
    alert(creatorCopy(error.message));
  } finally {
    $('start').disabled = false;
    $('start').textContent = START_LABELS[assistMode] || START_LABELS.writer;
  }
});

$('approve').addEventListener('click', async () => {
  if (!currentRunId) return;
  $('approve').disabled = true;
  try {
    const run = await api(`/api/story-engine/runs/${encodeURIComponent(currentRunId)}/approve`, { method: 'POST', body: '{}' });
    renderRun(run);
    if (shouldPoll(run)) startPolling();
  } catch (error) {
    alert(creatorCopy(error.message));
  } finally {
    $('approve').disabled = false;
  }
});

const initialParams = new URLSearchParams(window.location.search);
const initialRunId = initialParams.get('run_id');
const initialWorkspaceId = initialParams.get('workspace_id');
ensureUniverseLink(initialWorkspaceId);

if (initialRunId) {
  enterStudioMode();
  currentRunId = initialRunId;
  refreshRun().then(run => {
    if (run && shouldPoll(run)) startPolling();
  });
} else {
  loadDefaultAssistMode();
}
