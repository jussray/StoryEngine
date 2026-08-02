const videoById = id => document.getElementById(id);
const videoEscape = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function videoStatusClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('error') || normalized.includes('fail')) return 'red';
  if (normalized.includes('await') || normalized.includes('ready')) return 'gold';
  return 'green';
}

function renderVideoEngineControlRoom(data) {
  const statusClass = videoStatusClass(data.status);
  const cards = [
    ['Machine status', data.status || 'idle', statusClass, 'Deterministic renderer health'],
    ['Total jobs', data.total_jobs || 0, 'blue', 'All generated video blueprints'],
    ['Validated', data.validated_count || 0, 'green', 'Passed Playwright gate'],
    ['Visual styles', `${data.style_count || 0}/${data.available_style_count || 0}`, 'purple', 'Used styles versus available catalog'],
    ['Awaiting gate', data.ready_for_validation_count || 0, 'gold', 'Artifact exists; validation pending'],
    ['Failed', data.failed_count || 0, data.failed_count ? 'red' : 'green', 'Blocked before release'],
    ['Provider spend', '$0.00', 'teal', 'Broke-founder deterministic MVP']
  ];
  videoById('videoEngineStats').innerHTML = cards.map(([label, value, cls, sub]) =>
    `<article class="card"><div class="label">${videoEscape(label)}</div><div class="value ${cls}" data-testid="video-engine-${videoEscape(label.toLowerCase().replaceAll(' ', '-'))}">${videoEscape(value)}</div><div class="sub">${videoEscape(sub)}</div></article>`
  ).join('');

  const jobs = data.recent_jobs || [];
  videoById('videoEngineJobs').innerHTML = jobs.length ? jobs.map(job =>
    `<div class="row" data-testid="video-engine-job"><div class="row-title">${videoEscape(job.mode)} · ${videoEscape(job.visual_style || 'legacy_style')} · ${videoEscape(job.status)}</div><div class="row-meta">${videoEscape(job.workspace_id)} · ${videoEscape(job.quality)} · ${videoEscape(job.aspect_ratio)} · $${Number(job.actual_cost_usd || 0).toFixed(2)}</div><div class="row-actions"><a class="btn" href="/video_studio.html?workspace_id=${encodeURIComponent(job.workspace_id)}">Studio</a>${job.artifact_id ? `<a class="btn" href="/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html" target="_blank" rel="noreferrer">Artifact</a>` : ''}</div></div>`
  ).join('') : '<div class="empty">No video jobs yet. Generate the first free animatic in Video Studio.</div>';
  videoById('videoEngineUpdated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function loadVideoEngineControlRoom() {
  try {
    const response = await fetch('/api/video-engine/control-room', { headers: { 'Content-Type': 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
    renderVideoEngineControlRoom(data);
  } catch (error) {
    videoById('videoEngineStats').innerHTML = `<article class="card"><div class="label">Machine status</div><div class="value red" data-testid="video-engine-machine-status">Unavailable</div><div class="sub">${videoEscape(error.message)}</div></article>`;
    videoById('videoEngineJobs').innerHTML = '<div class="empty">Video-engine evidence could not be loaded.</div>';
  }
}

videoById('refresh')?.addEventListener('click', loadVideoEngineControlRoom);
loadVideoEngineControlRoom();
setInterval(loadVideoEngineControlRoom, 30_000);
