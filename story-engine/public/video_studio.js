const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let options = null;
let currentJob = null;
let draftShots = [];
let rendererStatus = null;
let renderEvidence = null;

async function api(path, init={}){
  const response = await fetch(path,{headers:{'Content-Type':'application/json'},...init});
  const data = await response.json().catch(()=>({}));
  if(!response.ok && response.status !== 422){
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.code=data.code || null;
    error.status=response.status;
    error.failure_receipt=data.failure_receipt || null;
    throw error;
  }
  return data;
}

function isLiveAction(){ return $('mode').value === 'live_action'; }

function actionBeatValues(){
  return $('actionBeats').value
    .split(/\r?\n/)
    .map(value=>value.trim())
    .filter(Boolean);
}

function shortCookie(value){
  const text=String(value || '');
  return text.length > 24 ? `${text.slice(0,18)}…${text.slice(-6)}` : text;
}

function renderRendererStatusCard(){
  let card=$('openRendererStatusCard');
  if(!card){
    card=document.createElement('section');
    card.id='openRendererStatusCard';
    card.className='card';
    card.dataset.testid='open-renderer-status-card';
    $('jobForm').before(card);
  }
  const ready=rendererStatus?.ready === true;
  const configured=rendererStatus?.configured === true;
  const blocker=rendererStatus?.blocker || null;
  const state=ready ? 'READY' : configured ? 'BLOCKED' : 'NOT CONFIGURED';
  const cls=ready ? 'ok' : 'warn';
  card.innerHTML=`<div class="eyebrow">Actual video renderer</div><div class="plan-tools"><span class="status ${cls}" data-testid="open-renderer-state">${esc(state)}</span><button id="refreshRendererStatus" class="btn" type="button">Refresh GPU</button></div><p class="sub"><strong>Primary lane:</strong> self-hosted/open-weight ComfyUI. Vendor credits are not required for this lane.</p><div class="tags"><span class="tag">compute ${rendererStatus?.compute_reachable ? 'reachable' : 'not proven'}</span><span class="tag">workflow ${rendererStatus?.workflow_configured ? 'configured' : 'missing'}</span><span class="tag">license ${rendererStatus?.license_verified ? 'verified' : 'not verified'}</span></div>${blocker ? `<p class="sub" data-testid="open-renderer-blocker">Blocker: ${esc(blocker)}</p>` : ''}<p class="plan-help">This status is runtime evidence only. It does not grant publish, merge, or provider authority.</p>`;
  $('refreshRendererStatus').addEventListener('click',refreshRendererStatus);
}

async function refreshRendererStatus(){
  try{ rendererStatus=await api('/api/video-engine/open-renderer/status'); }
  catch{ rendererStatus={ready:false,configured:false,blocker:'OPEN_RENDER_STATUS_UNKNOWN',vendor_credit_required:false,authority:'none'}; }
  renderRendererStatusCard();
  if(currentJob) renderActualControls();
  return rendererStatus;
}

function renderLookNotes(){
  const mode = options?.modes?.[$('mode').value];
  const style = options?.visual_styles?.[$('visualStyle').value];
  $('modeNote').textContent = mode ? `${mode.label}: ${mode.description} Blueprint renderer status: ${mode.status}.` : '';
  $('styleNote').textContent = style ? `${style.label}: ${style.description} Best with: ${style.recommended_modes.map(value=>options.modes[value]?.label || value).join(', ')}.` : '';
  $('customStyleField').classList.toggle('hidden', $('visualStyle').value !== 'custom');
  $('liveActionFields').classList.toggle('hidden', !isLiveAction());
  if(isLiveAction() && $('visualStyle').value === 'soft_cinematic_bookish' && options?.visual_styles?.bright_human_future){
    $('visualStyle').value='bright_human_future';
    renderLookNotes();
  }
}

function renderDraftShots(){
  const strip = $('shotStrip');
  if(!strip) return;
  strip.innerHTML = draftShots.map((shot,index)=>`<article class="shot" data-testid="video-studio-shot" data-shot-id="${esc(shot.shot_id)}"><div class="tags"><span class="tag">${esc(shot.shot_id)}</span><span class="tag">${esc(shot.shot_type)}</span><span class="tag">${esc(shot.camera_move)}</span><span class="tag">${shot.duration_seconds}s</span>${shot.delivery_role ? `<span class="tag">${esc(shot.delivery_role)}</span>` : ''}</div><h3>${esc(shot.source_chapter_title)}</h3><p>${esc(shot.narration)}</p><div class="field shot-command"><label for="shot-command-${index}">Shot command</label><input id="shot-command-${index}" data-testid="shot-command-input" data-index="${index}" list="shotCommandTemplates" value="${esc(shot.shot_command || '')}" aria-label="Shot ${index + 1} command"></div><div class="tags"><span class="tag">${esc(shot.visual_style)}</span><span class="tag">${esc(shot.emotion)}</span><span class="tag">${esc(shot.intensity)}</span>${shot.visible_action_required ? '<span class="tag">visible action required</span>' : ''}<span class="tag">$0.00 preview</span></div><div class="shot-controls"><button class="btn" data-testid="shot-move-earlier" data-index="${index}" data-move="-1" type="button" ${index===0?'disabled':''}>← Earlier</button><button class="btn" data-testid="shot-move-later" data-index="${index}" data-move="1" type="button" ${index===draftShots.length-1?'disabled':''}>Later →</button></div></article>`).join('');

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

function currentRenderCount(){
  const rows=renderEvidence?.renders || [];
  return new Set(rows.filter(row=>row.status==='complete' && row.continuity?.receipt_status==='CURRENT').map(row=>row.shot_id)).size;
}

function renderActualControls(){
  const host=$('actualRenderControls');
  if(!host || !currentJob) return;
  const contract=currentJob.blueprint?.production_contract || {};
  if(!contract.playable_video_required){ host.innerHTML=''; return; }
  const planValidated=['preview_validated','validated'].includes(currentJob.status);
  const rendererReady=rendererStatus?.ready === true;
  const rendered=currentRenderCount();
  const total=Number(currentJob.blueprint?.shot_count || 0);
  const allRendered=total>0 && rendered>=total;
  const blocker=!planValidated ? 'Run the Playwright plan gate first.' : !rendererReady ? `GPU lane blocked: ${rendererStatus?.blocker || 'runtime not ready'}.` : null;
  host.innerHTML=`<div class="delivery-note" data-testid="actual-render-truth"><strong>Actual footage:</strong> ${rendered}/${total} current shots rendered. Self-hosted/open-weight is primary. Paid generation is fallback only.</div><div class="plan-tools"><button id="openRenderActual" data-testid="open-render-actual" class="btn primary" type="button" ${planValidated&&rendererReady?'':'disabled'}>Render Actual Video</button><button id="assembleOpenMaster" data-testid="assemble-open-master" class="btn" type="button" ${allRendered?'':'disabled'}>Assemble Master</button><button id="refreshRenderEvidence" class="btn" type="button">Refresh Evidence</button></div>${blocker?`<p class="sub" data-testid="actual-render-blocker">${esc(blocker)}</p>`:''}`;
  if($('openRenderActual')) $('openRenderActual').addEventListener('click',renderCurrentOpen);
  if($('assembleOpenMaster')) $('assembleOpenMaster').addEventListener('click',assembleCurrentOpen);
  if($('refreshRenderEvidence')) $('refreshRenderEvidence').addEventListener('click',refreshRenderEvidence);
}

async function refreshRenderEvidence(){
  if(!currentJob) return null;
  try{
    renderEvidence=await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/open-renders`);
    const marker=$('continuityMarker');
    if(marker){
      const cookie=renderEvidence?.continuity_cookie?.value || '';
      const stale=(renderEvidence?.renders || []).filter(row=>row.continuity?.receipt_status==='STALE').length;
      marker.innerHTML=`<strong>Continuity cookie:</strong> <code data-testid="continuity-cookie">${esc(shortCookie(cookie))}</code> · current rendered shots ${currentRenderCount()}/${Number(currentJob.blueprint?.shot_count||0)} · stale receipts ${stale}. <span class="sub">Marker only, never authority.</span>`;
    }
  }catch{
    renderEvidence=null;
    const marker=$('continuityMarker');
    if(marker) marker.textContent='Continuity evidence unavailable. No authority inferred.';
  }
  renderActualControls();
  return renderEvidence;
}

async function renderCurrentOpen(){
  if(!currentJob) return;
  const button=$('openRenderActual');
  if(button){button.disabled=true;button.textContent='Rendering on GPU…';}
  $('formStatus').textContent=''; $('formStatus').className='sub';
  try{
    const result=await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/open-render`,{method:'POST',body:JSON.stringify({continue_on_failure:false})});
    await refreshRenderEvidence();
    $('formStatus').textContent=result.complete
      ? 'Actual shot set rendered. Continuity receipts are current; assemble the master next.'
      : `Rendering stopped on ${result.results?.find(item=>item.status==='failed')?.failure?.failure_class || 'a recorded failure'}. Earlier successful shots remain preserved.`;
  }catch(error){
    $('formStatus').textContent=`${error.code || 'OPEN_RENDER_FAILED'}: ${error.message}`;
    $('formStatus').className='error';
  }finally{ renderActualControls(); }
}

async function assembleCurrentOpen(){
  if(!currentJob) return;
  const button=$('assembleOpenMaster');
  if(button){button.disabled=true;button.textContent='Assembling…';}
  $('formStatus').textContent=''; $('formStatus').className='sub';
  try{
    const receipt=await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/open-assemble`,{method:'POST',body:'{}'});
    $('formStatus').textContent=`Master verified: ${Number(receipt.media_probe?.duration_seconds||0).toFixed(1)}s · proof ${shortCookie(receipt.proof_cookie)}. This proof cookie records evidence; it does not authorize publishing.`;
  }catch(error){
    $('formStatus').textContent=`${error.code || 'OPEN_RENDER_ASSEMBLY_FAILED'}: ${error.message}`;
    $('formStatus').className='error';
  }finally{ renderActualControls(); }
}

function renderJob(job){
  currentJob = job;
  const blueprint = job.blueprint || {};
  const validation = job.validation || {};
  const contract = blueprint.production_contract || {};
  draftShots = (blueprint.shots || []).map(shot=>({...shot}));
  const cls = ['validated','preview_validated'].includes(job.status) ? 'ok' : job.status === 'failed' ? 'bad' : 'warn';
  const deliveryNote = contract.playable_video_required
    ? `<div class="delivery-note" data-testid="final-delivery-note"><strong>Preview only.</strong> Playwright proves the shot plan, not the movie. Final delivery requires verified playable footage. The primary render lane is self-hosted/open-weight GPU; paid vendors are optional fallback. Concept ≠ deliverable.</div>`
    : '';
  $('result').className='';
  $('result').innerHTML=`<section class="card" data-testid="video-job-result"><div class="eyebrow">${esc(blueprint.target_mode_label || blueprint.target_mode)} · ${esc(blueprint.visual_style_label || blueprint.visual_style)} · ${esc(blueprint.preview_renderer)}</div><h2>${esc(blueprint.title)}</h2><span class="status ${cls}" data-testid="video-job-status">${esc(job.status)}</span><p class="sub">${blueprint.shot_count || 0} shots · ${blueprint.duration_seconds || 0}s · ${esc(blueprint.aspect_ratio)} · style fit ${esc(blueprint.style_fit)} · source revision ${esc(String(job.source_revision_id||'').slice(0,12))}</p>${deliveryNote}<div id="continuityMarker" class="mode-note" data-testid="continuity-marker">Loading continuity marker…</div><div class="plan-tools"><a class="btn primary" href="/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html" target="_blank" rel="noreferrer">Open Production Preview</a><button id="saveShotPlan" data-testid="save-shot-plan" class="btn" type="button">Save Shot Plan</button><button id="validateJob" class="btn" type="button">Run Playwright Gate</button><span class="plan-revision" data-testid="shot-plan-revision">shot plan r${Number(blueprint.shot_plan_revision || 0)}</span></div><div id="actualRenderControls"></div><p class="plan-help">Edit a command or move a card. Saving recompiles provider-neutral direction, changes the continuity cookie, and invalidates old render proof. Live-action preview validation never grants final-delivery or publish authority.</p>${validation.validated_at ? `<p class="sub">Playwright preview proof: ${validation.passed ? 'passed' : 'failed'} · final delivery: ${validation.satisfies_final_delivery ? 'satisfied' : 'not yet satisfied'} · ${new Date(validation.validated_at).toLocaleString()}</p>` : ''}</section><div id="shotStrip" class="shots" data-testid="editable-shot-strip"></div>`;
  $('validateJob').addEventListener('click',validateCurrent);
  $('saveShotPlan').addEventListener('click',saveCurrentShotPlan);
  renderDraftShots();
  renderActualControls();
  refreshRenderEvidence();
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
    renderEvidence=null;
    renderJob(updated);
    $('formStatus').textContent='Shot plan saved. The continuity cookie changed; old render proof is now stale and Playwright plan validation is required again.';
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
  await refreshRendererStatus();
}

$('mode').addEventListener('change',renderLookNotes);
$('visualStyle').addEventListener('change',renderLookNotes);
$('jobForm').addEventListener('submit',async event=>{
  event.preventDefault(); const button=$('generate'); button.disabled=true; button.textContent='Planning and rendering preview…'; $('formStatus').textContent=''; $('formStatus').className='sub';
  try{
    const body={workspace_id:$('workspaceId').value.trim(),mode:$('mode').value,visual_style:$('visualStyle').value,custom_style_prompt:$('customStylePrompt').value.trim(),quality:$('quality').value,aspect_ratio:$('aspectRatio').value};
    if(isLiveAction()){
      body.primary_subject=$('primarySubject').value.trim();
      body.product_or_world=$('productOrWorld').value.trim();
      body.viewer_takeaway=$('viewerTakeaway').value.trim();
      body.action_beats=actionBeatValues();
    }
    const job=await api('/api/video-engine/jobs',{method:'POST',body:JSON.stringify(body)});
    renderEvidence=null;
    renderJob(job);
    $('formStatus').textContent=job.blueprint?.production_contract?.playable_video_required
      ? 'Production preview created. Edit and validate the plan, then render the actual footage on the self-hosted GPU lane.'
      : 'Free deterministic artifact created. Edit the shot strip or validate it as-is.';
  }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';}
  finally{button.disabled=false;button.textContent='Generate Production Preview';}
});

const params=new URLSearchParams(location.search); if(params.get('workspace_id')) $('workspaceId').value=params.get('workspace_id');
loadOptions().catch(error=>{$('formStatus').textContent=error.message;$('formStatus').className='error';});