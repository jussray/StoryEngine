const params = new URLSearchParams(window.location.search);
const workspace_id = params.get('workspace_id');
document.getElementById('homeLink').href = `/story_home.html?workspace_id=${workspace_id}`;

async function loadEvents() {
  const events = await fetch(`/api/events/${workspace_id}?limit=200`).then(r => r.json());
  document.getElementById('count').textContent = `(${events.length})`;
  const tbody = document.getElementById('eventBody');
  tbody.innerHTML = events.map(e => {
    const time = new Date(e.created_at).toLocaleTimeString();
    const dur = e.duration_ms != null ? `${e.duration_ms}ms` : '—';
    const rb = e.rollback ? '⚠️' : '';
    return `<tr><td>${time}</td><td>${e.event_type}</td><td>${e.mode || '—'}</td><td>${dur}</td><td>${rb}</td></tr>`;
  }).join('');
}

document.getElementById('refreshBtn').addEventListener('click', loadEvents);
loadEvents();
