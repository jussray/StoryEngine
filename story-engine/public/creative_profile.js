const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed ${response.status}`);
  return data;
}

function title(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fillSelect(id, values) {
  $(id).innerHTML = values.map(value => `<option value="${esc(value)}">${esc(title(value))}</option>`).join('');
}

function render(profile) {
  $('summary').innerHTML = `
    <h2>${esc(title(profile.story_kind))}: ${esc(title(profile.medium))} for ${esc(title(profile.audience))}</h2>
    <p>${esc(profile.story_vision || '')}</p>
    <p class="sub">${esc(profile.resolved_rules.profile_instruction || '')}</p>
    <p class="ok"><strong>OODA aligned</strong> · profile v${profile.version}</p>
    <p class="sub">Human decision required · Redteam before Runtime · Redteam before Release</p>`;

  const entries = Object.entries(profile.resolved_rules || {}).filter(([key]) => ![
    'profile_instruction','require_human_decision','redteam_pre_runtime','redteam_pre_release','story_vision'
  ].includes(key));
  $('rules').innerHTML = entries.map(([key, value]) => `
    <article class="rule"><b>${esc(title(key))}</b><span class="sub">${esc(value)}</span></article>
  `).join('');
}

async function loadExisting() {
  const workspaceId = $('workspace').value;
  if (!workspaceId) return;
  try {
    const profile = await api(`/api/creative-profile/${workspaceId}`);
    $('storyVision').value = profile.story_vision || '';
    $('storyKind').value = profile.story_kind || 'other';
    $('emotionalEffect').value = profile.emotional_effect || 'mixed';
    $('medium').value = profile.medium;
    $('audience').value = profile.audience;
    $('eli').value = profile.eli_level || '';
    $('genre').value = profile.genre || '';
    $('tone').value = profile.tone || '';
    $('goal').value = profile.goal;
    $('constraints').value = (profile.constraints || []).join(', ');
    $('outputs').value = (profile.outputs || []).join(', ');
    render(profile);
  } catch {
    const story = window.__stories?.find(item => item.workspace_id === workspaceId);
    $('storyVision').value = story?.pitch || '';
    $('genre').value = story?.genre || '';
    $('summary').innerHTML = '<h2>Resolved Story Strategy</h2><p class="sub">No Creative Profile exists for this workspace yet.</p>';
    $('rules').innerHTML = '';
  }
}

async function load() {
  const [stories, options] = await Promise.all([
    api('/api/stories'),
    api('/api/creative-profile/options')
  ]);
  window.__stories = stories;
  $('workspace').innerHTML = stories.map(story => `<option value="${esc(story.workspace_id)}">${esc(story.title)}</option>`).join('');
  fillSelect('storyKind', options.story_kinds);
  fillSelect('emotionalEffect', options.emotional_effects);
  fillSelect('medium', options.mediums);
  fillSelect('audience', options.audiences);
  fillSelect('goal', options.goals);
  await loadExisting();
}

$('workspace').addEventListener('change', loadExisting);
$('audience').addEventListener('change', () => {
  if (['eli5', 'eli10'].includes($('audience').value)) $('eli').value = $('audience').value;
});
$('storyKind').addEventListener('change', () => {
  if (!$('genre').value || $('genre').dataset.autofilled === 'true') {
    $('genre').value = title($('storyKind').value);
    $('genre').dataset.autofilled = 'true';
  }
});
$('genre').addEventListener('input', () => { $('genre').dataset.autofilled = 'false'; });

$('profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('status').textContent = 'Giving the story to OODA…';
  try {
    const profile = await api(`/api/creative-profile/${$('workspace').value}`, {
      method: 'POST',
      body: JSON.stringify({
        story_vision: $('storyVision').value,
        story_kind: $('storyKind').value,
        emotional_effect: $('emotionalEffect').value,
        medium: $('medium').value,
        audience: $('audience').value,
        eli_level: $('eli').value || undefined,
        genre: $('genre').value,
        tone: $('tone').value,
        goal: $('goal').value,
        constraints: $('constraints').value,
        outputs: $('outputs').value
      })
    });
    render(profile);
    $('status').textContent = 'Story intent saved. OODA now carries it through the full pipeline.';
  } catch (error) {
    $('status').textContent = error.message;
  }
});

load().catch(error => { $('status').textContent = error.message; });
