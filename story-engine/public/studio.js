const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed ${response.status}`);
  return data;
}

function render(ideas) {
  $('ideas').innerHTML = ideas.map(idea => `
    <article class="idea ${idea.selected ? 'selected' : ''}">
      <h3>${esc(idea.title)}</h3>
      <p class="sub">${esc(idea.premise)}</p>
      <p class="meta"><strong>Audience:</strong> ${esc(idea.target_audience)}</p>
      <p class="meta"><strong>Problem:</strong> ${esc(idea.problem_solved)}</p>
      <p class="meta"><strong>Why it sells:</strong> ${esc(idea.why_it_sells)}</p>
      <div class="scores">
        <div class="score"><b>${idea.market_score}</b><span class="meta">Market</span></div>
        <div class="score"><b>${idea.originality_score}</b><span class="meta">Original</span></div>
        <div class="score"><b>${idea.series_potential}</b><span class="meta">Series</span></div>
        <div class="score"><b>${idea.movie_potential}</b><span class="meta">Movie</span></div>
      </div>
      <button class="btn select" data-id="${esc(idea.idea_id)}" style="margin-top:10px">${idea.selected ? 'Selected' : 'Select'}</button>
    </article>`).join('') || '<p class="sub">No ideas yet.</p>';

  document.querySelectorAll('.select').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/studio/ideas/${button.dataset.id}/select`, { method: 'POST', body: '{}' });
      await load();
    });
  });
}

async function load() {
  const ideas = await api('/api/studio/ideas?limit=50');
  render(ideas);
}

$('forgeForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('status').textContent = 'Generating…';
  try {
    const result = await api('/api/studio/ideas/generate', {
      method: 'POST',
      body: JSON.stringify({
        niche: $('niche').value,
        audience: $('audience').value,
        tone: $('tone').value,
        count: Number($('count').value)
      })
    });
    render(result.ideas);
    $('status').textContent = `Generated ${result.ideas.length} ideas.`;
  } catch (error) {
    $('status').textContent = error.message;
  }
});

load().catch(() => {});
