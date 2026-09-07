const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let options = null;
let currentJob = null;
let draftShots = [];

async function api(path, init={}){
  const response = await fetch(path,{headers:{'Content-Type':'application/json'},...init});
  const data = await response.json().catch(()=>({}));
  if(!response.ok && response.status !== 422) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function renderLookNotes(){
  const mode = options?.modes?.[$('mode').value];
  const style = options?.visual_styles?.[$('visualStyle').value];
  $('modeNote').textContent = mode ? `${mode.label}: ${mode.description} Renderer status: ${mode.status}.` : '';
  $('styleNote').textContent = style ? `${style.label}: ${style.description} Best with: ${style.recommended_modes.map(value=>options.modes[value]?.label || value).join(', ')}.` : '';
  $('customStyleField').classList.toggle('hidden', $('visualStyle').value !== 'custom');
}

function renderDraftShots(){
  const strip = $('shotStrip');
  if(!strip) return;
  strip.innerHTML = draftShots.map((shot,index)=>`<article class="shot" data-testid="video-studio-shot" data-shot-id="${esc(shot.shot_id)}"><div class="tags"><span class="tag">${esc(shot.shot_id)}</span><span class="tag">${esc(shot.shot_type)}</span><span class="tag">${esc(shot.camera_move)}</span><span class="tag">${shot.duration_seconds}s</span></div><h3>${esc(shot.source_chapter_title)}</h3><p>${esc(shot.narration)}</p><div class="field shot-command"><label for="shot-command-${index}">Shot command</label><input id="shot-command-${index}" data-testid="shot-command-input" data-index="${index}" list="shotCommandTemplates" value="${esc(shot.shot_command || '')}" aria-label="Shot ${index + 1} command"></div><div class="tags"><span class="tag">${esc(shot.visual_style)}</span><span class="tag">${esc(shot.emotion)}</span><span class="tag">${esc(shot.intensity)}</span><span class="tag">$0.00</span></div><div class="shot-controls"><button class="btn" data-testid="shot-move-earlier" data-index="${index}" data-move="-1" type="button" ${index===0?'disabled':''}>← Earlier</button><button class="btn" data-testid="shot-move-later" data-index="${index}" data-move="1" type="button" ${index===draftShots.length-1?'disabled':''}>Later →</button></div></article>`).join('');

  strip.querySelectorAll('[data-testid="shot-command-input"]').forEach(input=>input.addEventListener('input',event=>{
    const index=Number(event.currentTarget.dataset.index);
    draftShots[index].shot_command=event.currentTarget.value;
  }));
  strip.querySelectorAll('[data-move]').forEach(button=>button.addEventListener('click',event=>{
    const from=Number(event.currentTarget.dataset.index);
    const to=from+Number(event.currentTarget.dataset.move);
    if(to<0 || to>=draftShots.length) return;
    [draftShots[from],draftShots[to]]=[draftShots[to],draftShots[from]];
    renderDraftShots();
  }));
}

function renderJob(job){
  currentJob = job;
  const blueprint = job.blueprint || {};
  const validation = job.validation || {};
  draftShots = (blueprint.shots || []).map(shot=>({...shot}));
  const cls = job.status === 'validated' ? 'ok' : job.status === 'failed' ? 'bad' : 'warn';
  $('result').className='';
  $('result').innerHTML=`<section class="card" data-testid="video-job-result"><div class="eyebrow">${esc(blueprint.target_mode_label || blueprint.target_mode)} · ${esc(blueprint.visual_style_label || blueprint.visual_style)} · ${esc(blueprint.preview_renderer)}</div><h2>${esc(blueprint.title)}</h2><span class="status ${cls}" data-testid="video-job-status">${esc(job.status)}</span><p class="sub">${blueprint.shot_count || 0} shots · ${blueprint.duration_seconds || 0}s · ${esc(blueprint.aspect_ratio)} · style fit ${esc(blueprint.style_fit)} · source revision ${esc(String(job.source_revision_id||'').slice(0,12))}</p><div class="plan-tools"><a class="btn primary" href="/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html" target="_blank" rel="noreferrer">Open Animated Artifact</a><button id="saveShotPlan" data-testid="save-shot-plan" class="btn" type="button">Save Shot Plan</button><button id="validateJob" class="btn" type="button">Run Playwright Gate</button><span class="plan-revision" data-testid="shot-plan-revision">shot plan r${Number(blueprint.shot_plan_revision || 0)}</span></div><p class="plan-help">Edit a command or move a card. Saving recompiles provider-neutral direction and clears any old validation. A completed MP4 freezes this plan.</p>${validation.validated_at ? `<p class="sub">Playwright: ${validation.passed ? 'passed' : 'failed'} · ${new Date(validation.validated_at).toLocaleString()}</p>` : ''}</section><div id="shotStrip" class="shots" data-testid="editable-shot-strip"></div>`;
  $('validateJob').addEventListener('click',validateCurrent);
  $('saveShotPlan').addEventListener('click',saveCurrentShotPlan);
  renderDraftShots();
}

async function saveCurrentShotPlan(){
  if(!currentJob) return;
  const button=$('saveShotPlan');
  button.disabled=true;
  button.textContent='Saving…';
  $('formStatus').textContent='';
  $('formStatus').className='sub';
  try{
    const updated=await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/shot-plan`,{
      method:'POST',
      body:JSON.stringify({shots:draftShots.map(shot=>({shot_id:shot.shot_id,command:String(shot.shot_command||'').trim()}))})
    });
    renderJob(updated);
    $('formStatus').textContent='Shot plan saved. Playwright validation is required again before export.';
  }catch(error){
    $('formStatus').textContent=error.message;
    $('formStatus').className='error';
    button.disabled=false;
    button.textContent='Save Shot Plan';
  }
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
  $('visualStyle').innerHTML = Object.entries(options.visual_styles).map(([value,item])=>`<option value="${esc(value)}">${esc(item.label)}</option>`).join('');
  $('quality').innerHTML = options.qualities.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  $('aspectRatio').innerHTML = options.aspect_ratios.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  $('styleStrip').innerHTML = Object.values(options.visual_styles).filter(item=>item.label !== 'Custom Art Direction').map(item=>`<span class="style-chip">${esc(item.label)}</span>`).join('');
  $('shotCommandTemplates').innerHTML=(options.shot_editor?.commands || []).map(item=>`<option value="${esc(item.template)}"></option>`).join('');
  renderLookNotes();
}

$('mode').addEventListener('change',renderLookNotes);
$('visualStyle').addEventListener('change',renderLookNotes);
$('jobForm').addEventListener('submit',async event=>{
  event.preventDefault(); const button=$('generate'); button.disabled=true; button.textContent='Planning and rendering…'; $('formStatus').textContent=''; $('formStatus').className='sub';
  try{
    const job=await api('/api/video-engine/jobs',{method:'POST',body:JSON.stringify({workspace_id:$('workspaceId').value.trim(),mode:$('mode').value,visual_style:$('visualStyle').value,custom_style_prompt:$('customStylePrompt').value.trim(),quality:$('quality').value,aspect_ratio:$('aspectRatio').value})});
    renderJob(job); $('formStatus').textContent='Free deterministic artifact created. Edit the shot strip or validate it as-is.';
  }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';}
  finally{button.disabled=false;button.textContent='Generate Free Animatic';}
});

const params=new URLSearchParams(location.search); if(params.get('workspace_id')) $('workspaceId').value=params.get('workspace_id');
loadOptions().catch(error=>{$('formStatus').textContent=error.message;$('formStatus').className='error';});
