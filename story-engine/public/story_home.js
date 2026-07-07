const params = new URLSearchParams(window.location.search);
const workspace_id = params.get('workspace_id');

if (!workspace_id) {
  window.location.href = '/';
}

const qs = `?workspace_id=${encodeURIComponent(workspace_id)}`;
document.getElementById('outlineLink').href = `/outline.html${qs}`;
document.getElementById('chaptersLink').href = `/chapters.html${qs}`;
document.getElementById('movieLink').href = `/movie.html${qs}`;
document.getElementById('lindymodeLink').href = `/lindymode_dashboard.html${qs}`;
document.getElementById('decisionLink').href = `/decision_dashboard.html${qs}`;
document.getElementById('learningLink').href = `/learning_dashboard.html${qs}`;
document.getElementById('recoveryLink').href = `/recovery_dashboard.html${qs}`;
document.getElementById('eventsLink').href = `/events_view.html${qs}`;

fetch(`/api/story/${encodeURIComponent(workspace_id)}`)
  .then(response => response.json())
  .then(story => {
    document.getElementById('storyTitle').textContent = story.title;
    document.getElementById('storyPitch').textContent = story.pitch || story.genre || '';
    document.title = `${story.title} — L99`;
  })
  .catch(() => {
    document.getElementById('storyTitle').textContent = 'Story not found';
  });
