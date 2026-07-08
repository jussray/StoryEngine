const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed ${response.status}`);
  return data;
}

function render(result) {
  const architecture = result.architecture?.structure || result.structure || {};
  const validation = result.validation || result.architecture?.validation || {};
  $('summary').innerHTML = `
    <h2>${esc(architecture.title || 'Architecture')}</h2>
    <p class="sub">${esc(architecture.premise || '')}</p>
    <p class="sub">${esc(architecture.genre || 'general')} · ${esc(architecture.audience || 'general readers')} · ${architecture.target_chapter_count || 0} chapters</p>
    <p class="${validation.passed ? 'ok' : 'warn'}"><strong>${validation.passed ? 'Validated' : 'Needs review'}</strong> · confidence ${validation.confidence ?? 0}%</p>
    ${validation.issues?.length ? `<p class="sub">${validation.issues.map(esc).join(' · ')}</p>` : ''}`;

  $('acts').innerHTML = (architecture.acts || []).map(act => `
    <section class="act">
      <h3>Act ${act.act}: ${esc(act.name)}</h3>
      <p class="sub">${esc(act.purpose)}</p>
      <div class="chapters">
        ${(act.chapters || []).map(chapter => `
          <article class="chapter">
            <b>Chapter ${chapter.chapter_number}: ${esc(chapter.title)}</b>
            <div class="sub">${esc(chapter.purpose)}</div>
            <div class="hook">${esc(chapter.emotional_hook)}</div>
            <div class="sub">Tension ${chapter.tension_score}</div>
          </article>`).join('')}
      </div>
    </section>`).join('');
}

async function loadOptions() {
  const [stories, ideas] = await Promise.all([
    api('/api/stories'),
    api('/api/studio/ideas?limit=100')
  ]);
  $('workspace').innerHTML = stories.map(story => `<option value="${esc(story.workspace_id)}">${esc(story.title)}</option>`).join('');
  $('idea').innerHTML = '<option value="">Use workspace story</option>' + ideas.map(idea => `<option value="${esc(idea.idea_id)}">${esc(idea.title)}</option>`).join('');
  if (stories[0]) {
    try {
      const existing = await api(`/api/studio/architect/${stories[0].workspace_id}`);
      render(existing);
    } catch {}
  }
}

$('workspace').addEventListener('change', async () => {
  try {
    const existing = await api(`/api/studio/architect/${$('workspace').value}`);
    render(existing);
  } catch {
    $('acts').innerHTML = '';
    $('summary').innerHTML = '<h2>Architecture Preview</h2><p class="sub">No architecture exists for this workspace yet.</p>';
  }
});

$('architectForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('status').textContent = 'Building architecture…';
  try {
    const result = await api('/api/studio/architect/generate', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: $('workspace').value,
        idea_id: $('idea').value || undefined,
        chapter_count: Number($('chapterCount').value),
        theme: $('theme').value,
        format: $('format').value
      })
    });
    render(result);
    $('status').textContent = result.validation.passed
      ? 'Architecture validated and queued for Runtime review.'
      : 'Architecture saved with review warnings.';
  } catch (error) {
    $('status').textContent = error.message;
  }
});

loadOptions().catch(error => { $('status').textContent = error.message; });
