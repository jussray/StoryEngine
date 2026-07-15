const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let options = null;
let currentJob = null;

async function api(path, init={}){
  const response = await fetch(path,{headers:{'Content-Type':'application/json'},...init});
  const data = await response.json().catch(()=>({}));
  if(!response.ok && response.status !== 422) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function modeNote(){
  const mode = options?.modes?.[$('mode').value];
  $('modeNote').textContent = mode ? `${mode.label}: ${mode.description} Renderer status: ${mode.status}.` : '';
}

function renderJob(job){
  currentJob = job;
  const blueprint = job.blueprint || {};
  const validation = job.validation || {};
  const cls = job.status === 'validated' ? 'ok' : job.status === 'failed' ? 'bad' : 'warn';
  const shots = (blueprint.shots || []).map(shot=>`<article class="shot" data-testid="video-studio-shot"><div class="tags"><span class="tag">${esc(shot.shot_id)}</span><span class="tag">${esc(shot.shot_type)}</span><span class="tag">${esc(shot.camera_move)}</span><span class="tag">${shot.duration_seconds}s</span></div><h3>${esc(shot.source_chapter_title)}</h3><p>${esc(shot.narration)}</p><div class="tags"><span class="tag">${esc(shot.emotion)}</span><span class="tag">${esc(shot.intensity)}</span><span class="tag">$0.00</span></div></article>`).join('');
  $('result').className='';
  $('result').innerHTML=`<section class="card" data-testid="video-job-result"><div class="eyebrow">${esc(blueprint.target_mode)} · ${esc(blueprint.preview_renderer)}</div><h2>${esc(blueprint.title)}</h2><span class="status ${cls}" data-testid="video-job-status">${esc(job.status)}</span><p class="sub">${blueprint.shot_count || 0} shots · ${blueprint.duration_seconds || 0}s · ${esc(blueprint.aspect_ratio)} · source revision ${esc(String(job.source_revision_id||'').slice(0,12))}</p><div class="actions"><a class="btn primary" href="/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html" target="_blank" rel="noreferrer">Open Animated Artifact</a><button id="validateJob" class="btn" type="button">Run Playwright Gate</button></div>${validation.validated_at ? `<p class="sub">Playwright: ${validation.passed ? 'passed' : 'failed'} · ${new Date(validation.validated_at).toLocaleString()}</p>` : ''}</section><div class="shots">${shots}</div>`;
  $('validateJob').addEventListener('click',validateCurrent);
}

async function validateCurrent(){
  if(!currentJob) return;
  const button=$('validateJob'); button.disabled=true; button.textContent='Validating…';
  try{renderJob(await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/validate`,{method:'POST',body:'{}'}));}
  catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';button.disabled=false;button.textContent='Run Playwright Gate';}
}

async function loadOptions(){
  options = await api('/api/video-engine/options');
  $('mode').innerHTML = Object.entries(options.modes).map(([value,item])=>`<option value="${esc(value)}">${esc(item.label)} — ${esc(item.status)}</option>`).join('');
  $('quality').innerHTML = options.qualities.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  $('aspectRatio').innerHTML = options.aspect_ratios.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  modeNote();
}

$('mode').addEventListener('change',modeNote);
$('jobForm').addEventListener('submit',async event=>{
  event.preventDefault(); const button=$('generate'); button.disabled=true; button.textContent='Planning and rendering…'; $('formStatus').textContent=''; $('formStatus').className='sub';
  try{
    const job=await api('/api/video-engine/jobs',{method:'POST',body:JSON.stringify({workspace_id:$('workspaceId').value.trim(),mode:$('mode').value,quality:$('quality').value,aspect_ratio:$('aspectRatio').value})});
    renderJob(job); $('formStatus').textContent='Free deterministic artifact created. Validate it before release.';
  }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';}
  finally{button.disabled=false;button.textContent='Generate Free Animatic';}
});

const params=new URLSearchParams(location.search); if(params.get('workspace_id')) $('workspaceId').value=params.get('workspace_id');
loadOptions().catch(error=>{$('formStatus').textContent=error.message;$('formStatus').className='error';});
