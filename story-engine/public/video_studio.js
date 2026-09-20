const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let options = null;
let currentJob = null;
let draftShots = [];
let rendererStatus = null;
let openEvidence = { renders: [], failures: [] };
let referenceImageDataUrl = null;

async function api(path, init={}){
  const response = await fetch(path,{headers:{'Content-Type':'application/json',...(init.headers||{})},...init});
  const data = await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data.error || `Request failed: ${response.status}`);
    error.status=response.status;
    error.data=data;
    throw error;
  }
  return data;
}

function isLiveAction(){ return $('mode').value === 'live_action'; }
function jobIsValidated(){ return ['validated','preview_validated'].includes(currentJob?.status); }
function shortCookie(value){
  const raw=String(value||'');
  return raw.length>30?`${raw.slice(0,21)}…${raw.slice(-7)}`:raw;
}

function actionBeatValues(){
  return $('actionBeats').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
}

function renderLookNotes(){
  const mode = options?.modes?.[$('mode').value];
  const style = options?.visual_styles?.[$('visualStyle').value];
  $('modeNote').textContent = mode ? `${mode.label}: ${mode.description} Renderer status: ${mode.status}.` : '';
  $('styleNote').textContent = style ? `${style.label}: ${style.description} Best with: ${style.recommended_modes.map(value=>options.modes[value]?.label || value).join(', ')}.` : '';
  $('customStyleField').classList.toggle('hidden', $('visualStyle').value !== 'custom');
  $('liveActionFields').classList.toggle('hidden', !isLiveAction());
  if(isLiveAction() && $('visualStyle').value === 'soft_cinematic_bookish' && options?.visual_styles?.bright_human_future){
    $('visualStyle').value='bright_human_future';
    renderLookNotes();
  }
}

function renderRendererStatus(){
  const state=$('rendererState');
  if(!rendererStatus){ state.className='status warn'; state.textContent='Unknown'; return; }
  state.className=`status ${rendererStatus.ready?'ok':rendererStatus.configured?'warn':'bad'}`;
  state.textContent=rendererStatus.ready?'Ready':rendererStatus.configured?'Needs attention':'Compute needed';
  $('rendererLane').textContent=rendererStatus.primary_lane==='self_hosted_open_weight'?'Self-hosted open-weight':'Unknown';
  $('vendorCreditTruth').textContent=rendererStatus.vendor_credit_required===false?'Not required':'Unknown';
  $('rendererModel').textContent=rendererStatus.model?.id || 'Not verified';
  $('rendererCompute').textContent=rendererStatus.compute_reachable?'GPU reachable':rendererStatus.configured?'Unreachable':'Not configured';
  const blockers=Array.isArray(rendererStatus.blockers)?rendererStatus.blockers:[];
  $('rendererBlockers').innerHTML=blockers.map(item=>`<div class="blocker" data-testid="renderer-blocker"><strong>${esc(item.id||item.code)}</strong> · ${esc(item.reason||item.code)}</div>`).join('');
  if(!blockers.length) $('rendererBlockers').innerHTML='<div class="status ok">Workflow + model + media tooling verified</div>';
}

async function loadRendererStatus(){
  try{rendererStatus=await api('/api/video-engine/open-renderer/status');}
  catch(error){rendererStatus={ready:false,configured:false,compute_reachable:false,vendor_credit_required:false,primary_lane:'self_hosted_open_weight',blockers:[{id:'GPU-UNKNOWN',reason:error.message}]};}
  renderRendererStatus();
  if(currentJob) renderJob(currentJob,{keepEvidence:true});
}

function evidenceForShot(shotId){
  const renders=Array.isArray(openEvidence?.renders)?openEvidence.renders:[];
  return renders.find(item=>item.shot_id===shotId && item.continuity?.receipt_status!=='STALE') || null;
}

function masterEvidence(){
  const renders=Array.isArray(openEvidence?.renders)?openEvidence.renders:[];
  return renders.find(item=>item.shot_id==='__master__' && item.continuity?.receipt_status!=='STALE') || null;
}

function currentShotRenders(){
  return draftShots.map(shot=>evidenceForShot(shot.shot_id)).filter(Boolean);
}

function approvedShotCount(){
  return draftShots.filter(shot=>{
    const item=evidenceForShot(shot.shot_id);
    return item?.status==='complete' && item.technical_status==='passed' && item.continuity_status==='approved' && item.editorial_status==='approved';
  }).length;
}

function continuityMarkup(){
  const marker=openEvidence?.continuity_cookie?.value || '';
  const stale=(openEvidence?.renders||[]).filter(item=>item.continuity?.receipt_status==='STALE').length;
  if(!marker) return '<div class="mode-note" data-testid="continuity-marker"><strong>Continuity cookie:</strong> waiting for job evidence. Marker only, never authority.</div>';
  return `<div class="mode-note" data-testid="continuity-marker"><strong>Continuity cookie:</strong> <code data-testid="continuity-cookie">${esc(shortCookie(marker))}</code> · stale render receipts ${stale}. <span class="sub">Bidirectional state marker only, never authority.</span></div>`;
}

function qaStatusClass(value){ return value==='approved'?'ok':value==='rejected'?'bad':'warn'; }

function shotRenderMarkup(shot,index){
  if(!currentJob?.blueprint?.production_contract?.playable_video_required) return '';
  const render=evidenceForShot(shot.shot_id);
  if(!render){
    const disabled=!jobIsValidated() || !rendererStatus?.ready || !referenceImageDataUrl;
    return `<div class="render-evidence"><div class="render-row"><div><strong>Actual footage</strong><br><small>No current render receipt for this continuity cookie.</small></div><button class="btn primary" data-render-shot="${index}" type="button" ${disabled?'disabled':''}>Render actual shot</button></div></div>`;
  }
  if(['submitted','rendering'].includes(render.status)){
    return `<div class="render-evidence"><div class="render-row"><div><strong>Actual footage</strong><br><small>${esc(render.status)} · render ${esc(render.render_id.slice(-8))}</small></div><span class="status info">Rendering</span></div></div>`;
  }
  if(render.status==='failed'){
    return `<div class="render-evidence"><div class="render-row"><div><strong>Actual footage</strong><br><small>This attempt failed without changing canon.</small></div><button class="btn" data-render-shot="${index}" type="button" ${!rendererStatus?.ready||!referenceImageDataUrl?'disabled':''}>Retry shot</button></div></div>`;
  }
  return `<div class="render-evidence" data-testid="shot-render-evidence"><video class="video-proof" controls preload="metadata" src="${esc(render.media_url)}"></video><div class="tags"><span class="status ok">Technical pass</span><span class="status ${qaStatusClass(render.continuity_status)}">Continuity ${esc(render.continuity_status)}</span><span class="status ${qaStatusClass(render.editorial_status)}">Editorial ${esc(render.editorial_status)}</span></div><div class="qa-grid"><div class="qa-box"><strong>Continuity review</strong><div class="actions"><button class="btn good" data-review-render="${esc(render.render_id)}" data-review-kind="continuity" data-review-value="approved" type="button">Approve</button><button class="btn bad" data-review-render="${esc(render.render_id)}" data-review-kind="continuity" data-review-value="rejected" type="button">Reject</button></div></div><div class="qa-box"><strong>Editorial review</strong><div class="actions"><button class="btn good" data-review-render="${esc(render.render_id)}" data-review-kind="editorial" data-review-value="approved" type="button">Approve</button><button class="btn bad" data-review-render="${esc(render.render_id)}" data-review-kind="editorial" data-review-value="rejected" type="button">Reject</button></div></div></div><div class="actions"><button class="btn" data-render-shot="${index}" type="button" ${!rendererStatus?.ready||!referenceImageDataUrl?'disabled':''}>Render another take</button></div></div>`;
}

function renderDraftShots(){
  const strip = $('shotStrip');
  if(!strip) return;
  strip.innerHTML = draftShots.map((shot,index)=>`<article class="shot" data-testid="video-studio-shot" data-shot-id="${esc(shot.shot_id)}"><div class="tags"><span class="tag">${esc(shot.shot_id)}</span><span class="tag">${esc(shot.shot_type)}</span><span class="tag">${esc(shot.camera_move)}</span><span class="tag">${shot.duration_seconds}s</span>${shot.delivery_role ? `<span class="tag">${esc(shot.delivery_role)}</span>` : ''}</div><h3>${esc(shot.source_chapter_title)}</h3><p>${esc(shot.narration)}</p><div class="field shot-command"><label for="shot-command-${index}">Shot command</label><input id="shot-command-${index}" data-testid="shot-command-input" data-index="${index}" list="shotCommandTemplates" value="${esc(shot.shot_command || '')}" aria-label="Shot ${index + 1} command"></div><div class="tags"><span class="tag">${esc(shot.visual_style)}</span><span class="tag">${esc(shot.emotion)}</span><span class="tag">${esc(shot.intensity)}</span>${shot.visible_action_required ? '<span class="tag">visible action required</span>' : ''}<span class="tag">canon-bound</span></div><div class="shot-controls"><button class="btn" data-testid="shot-move-earlier" data-index="${index}" data-move="-1" type="button" ${index===0?'disabled':''}>← Earlier</button><button class="btn" data-testid="shot-move-later" data-index="${index}" data-move="1" type="button" ${index===draftShots.length-1?'disabled':''}>Later →</button></div>${shotRenderMarkup(shot,index)}</article>`).join('');

  strip.querySelectorAll('[data-testid="shot-command-input"]').forEach(input=>input.addEventListener('input',event=>{
    const index=Number(event.currentTarget.dataset.index); draftShots[index].shot_command=event.currentTarget.value;
  }));
  strip.querySelectorAll('[data-move]').forEach(button=>button.addEventListener('click',event=>{
    const from=Number(event.currentTarget.dataset.index),to=from+Number(event.currentTarget.dataset.move);
    if(to<0 || to>=draftShots.length) return;
    [draftShots[from],draftShots[to]]=[draftShots[to],draftShots[from]]; renderDraftShots();
  }));
  strip.querySelectorAll('[data-render-shot]').forEach(button=>button.addEventListener('click',()=>submitShotRender(Number(button.dataset.renderShot))));
  strip.querySelectorAll('[data-review-render]').forEach(button=>button.addEventListener('click',()=>reviewRender(button.dataset.reviewRender,button.dataset.reviewKind,button.dataset.reviewValue)));
}

function allShotsApproved(){
  return draftShots.length>0 && approvedShotCount()===draftShots.length;
}

function masterMarkup(){
  const master=masterEvidence();
  if(!master) return '';
  return `<section class="card master" data-testid="picture-lock"><div class="eyebrow">Picture lock</div><h3>Approved shots assembled</h3><video class="video-proof" controls preload="metadata" src="${esc(master.media_url)}"></video><div class="master-note"><strong>Not release-ready yet.</strong> This is verified picture lock. Final sound design, final-audio review and caption timing remain separate release gates.</div><div class="tags"><span class="status ok">Media verified</span><span class="status warn">Audio pending</span><span class="status warn">Captions after final audio</span></div></section>`;
}

function productionMarkup(contract){
  if(!contract.playable_video_required) return '';
  const approved=allShotsApproved();
  const failureCount=Array.isArray(openEvidence?.failures)?openEvidence.failures.length:0;
  const currentRenders=currentShotRenders();
  const rendered=currentRenders.filter(item=>item.status==='complete' && item.technical_status==='passed').length;
  const approvedCount=approvedShotCount();
  const total=draftShots.length;
  return `<section class="card production-card" data-testid="real-footage-production"><div class="production-head"><div><div class="eyebrow">Actual video production</div><h2>Render → inspect → approve → assemble</h2><p class="sub">Each failed shot keeps its own receipt. Existing approved shots stay intact.</p></div><span class="status ${rendererStatus?.ready?'ok':'warn'}">${rendererStatus?.ready?'Renderer ready':'Infrastructure gated'}</span></div>${continuityMarkup()}<div class="delivery-note" data-testid="actual-render-truth"><strong>Actual footage:</strong> ${rendered}/${total} technically verified · ${approvedCount}/${total} film-approved. Plan proof is not footage proof.</div><div class="plan-tools"><button id="refreshEvidence" class="btn" type="button">Refresh render evidence</button><button id="assembleMaster" class="btn primary" type="button" ${approved?'':'disabled'}>Assemble approved picture lock</button><span class="tag">${failureCount} failure receipt${failureCount===1?'':'s'}</span></div></section>${masterMarkup()}`;
}

function renderJob(job,{keepEvidence=false}={}){
  currentJob = job;
  const blueprint = job.blueprint || {};
  const validation = job.validation || {};
  const contract = blueprint.production_contract || {};
  draftShots = (blueprint.shots || []).map(shot=>({...shot}));
  if(!keepEvidence) openEvidence={renders:[],failures:[]};
  const cls = ['validated','preview_validated'].includes(job.status) ? 'ok' : job.status === 'failed' ? 'bad' : 'warn';
  const deliveryNote = contract.playable_video_required
    ? `<div class="delivery-note" data-testid="final-delivery-note"><strong>Plan ≠ finished movie.</strong> Playwright verifies the production plan. Final delivery requires real playable footage. Self-hosted/open-weight rendering is the primary lane; paid renderers are optional shot-level fallback, never authority.</div>`
    : '';
  $('result').className='';
  $('result').innerHTML=`<section class="card" data-testid="video-job-result"><div class="eyebrow">${esc(blueprint.target_mode_label || blueprint.target_mode)} · ${esc(blueprint.visual_style_label || blueprint.visual_style)} · ${esc(blueprint.preview_renderer)}</div><h2>${esc(blueprint.title)}</h2><span class="status ${cls}" data-testid="video-job-status">${esc(job.status)}</span><p class="sub">${blueprint.shot_count || 0} shots · ${blueprint.duration_seconds || 0}s · ${esc(blueprint.aspect_ratio)} · style fit ${esc(blueprint.style_fit)} · source revision ${esc(String(job.source_revision_id||'').slice(0,12))}</p>${deliveryNote}<div class="plan-tools"><a class="btn primary" href="/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html" target="_blank" rel="noreferrer">Open Production Plan</a><button id="saveShotPlan" data-testid="save-shot-plan" class="btn" type="button">Save Shot Plan</button><button id="validateJob" class="btn" type="button">Run Playwright Gate</button><span class="plan-revision" data-testid="shot-plan-revision">shot plan r${Number(blueprint.shot_plan_revision || 0)}</span></div><p class="plan-help">Editing the plan invalidates old validation and changes the continuity cookie. Old footage remains historical evidence but cannot silently satisfy the new cut.</p>${validation.validated_at ? `<p class="sub">Playwright plan proof: ${validation.passed ? 'passed' : 'failed'} · final delivery: ${validation.satisfies_final_delivery ? 'satisfied' : 'requires real footage'} · ${new Date(validation.validated_at).toLocaleString()}</p>` : ''}</section>${productionMarkup(contract)}<div id="shotStrip" class="shots" data-testid="editable-shot-strip"></div>`;
  $('validateJob').addEventListener('click',validateCurrent);
  $('saveShotPlan').addEventListener('click',saveCurrentShotPlan);
  if($('refreshEvidence')) $('refreshEvidence').addEventListener('click',refreshEvidence);
  if($('assembleMaster')) $('assembleMaster').addEventListener('click',assembleMaster);
  renderDraftShots();
}

async function saveCurrentShotPlan(){
  if(!currentJob) return;
  const button=$('saveShotPlan'); button.disabled=true; button.textContent='Saving…';
  $('formStatus').textContent=''; $('formStatus').className='sub';
  try{
    const updated=await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/shot-plan`,{method:'POST',body:JSON.stringify({shots:draftShots.map(shot=>({shot_id:shot.shot_id,command:String(shot.shot_command||'').trim()}))})});
    openEvidence={renders:[],failures:[]}; renderJob(updated);
    $('formStatus').textContent='Shot plan saved. Old proof is stale; run the Playwright plan gate again.';
  }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';button.disabled=false;button.textContent='Save Shot Plan';}
}

async function validateCurrent(){
  if(!currentJob) return;
  const button=$('validateJob'); button.disabled=true; button.textContent='Validating…';
  try{
    const validated=await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/validate`,{method:'POST',body:'{}'});
    renderJob(validated,{keepEvidence:true});
    await refreshEvidence();
  }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';button.disabled=false;button.textContent='Run Playwright Gate';}
}

async function refreshEvidence(){
  if(!currentJob) return;
  try{
    openEvidence=await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/open-renders`);
    renderJob(currentJob,{keepEvidence:true});
  }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';}
}

async function submitShotRender(index){
  const shot=draftShots[index];
  if(!shot || !currentJob) return;
  if(!jobIsValidated()){ $('formStatus').textContent='Run the Playwright production-plan gate before real rendering.'; $('formStatus').className='error'; return; }
  if(!rendererStatus?.ready){ $('formStatus').textContent='The self-hosted renderer is not ready. Check the infrastructure receipt above.'; $('formStatus').className='error'; return; }
  if(!referenceImageDataUrl){ $('formStatus').textContent='Choose the approved canonical reference image before rendering.'; $('formStatus').className='error'; return; }
  $('formStatus').textContent=`Submitting ${shot.shot_id} to the open-weight renderer…`; $('formStatus').className='sub';
  try{
    const submitted=await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/open-render`,{method:'POST',body:JSON.stringify({shot_id:shot.shot_id,reference_image_data_url:referenceImageDataUrl})});
    await refreshEvidence();
    pollRender(submitted.render_id);
  }catch(error){
    const code=error.data?.code?` (${error.data.code})`:'';
    $('formStatus').textContent=`${error.message}${code}`; $('formStatus').className='error'; await refreshEvidence();
  }
}

async function pollRender(renderId){
  for(let attempt=0;attempt<360;attempt+=1){
    await new Promise(resolve=>setTimeout(resolve,2500));
    try{
      const render=await api(`/api/video-engine/open-renders/${encodeURIComponent(renderId)}`);
      if(['complete','failed'].includes(render.status)){
        $('formStatus').textContent=render.status==='complete'?'Actual footage rendered. Review continuity and editorial quality before assembly.':'Render failed. Its failure receipt is preserved; other shots are untouched.';
        $('formStatus').className=render.status==='complete'?'sub':'error';
        await refreshEvidence(); return;
      }
      if(attempt%4===0) await refreshEvidence();
    }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';return;}
  }
  $('formStatus').textContent='Render is still running. Use Refresh render evidence to check it later.';
}

async function reviewRender(renderId,kind,value){
  const current=(openEvidence.renders||[]).find(item=>item.render_id===renderId);
  if(!current) return;
  const body={continuity_status:kind==='continuity'?value:current.continuity_status,editorial_status:kind==='editorial'?value:current.editorial_status,notes:value==='rejected'?`${kind} rejected in Story Video Studio.`:''};
  try{await api(`/api/video-engine/open-renders/${encodeURIComponent(renderId)}/review`,{method:'POST',body:JSON.stringify(body)});await refreshEvidence();}
  catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';}
}

async function assembleMaster(){
  if(!currentJob || !allShotsApproved()) return;
  const button=$('assembleMaster'); button.disabled=true; button.textContent='Assembling…';
  try{
    await api(`/api/video-engine/jobs/${encodeURIComponent(currentJob.job_id)}/open-assemble`,{method:'POST',body:'{}'});
    $('formStatus').textContent='Picture lock assembled from approved actual footage. Final audio and captions remain separate release gates.'; $('formStatus').className='sub';
    await refreshEvidence();
  }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';button.disabled=false;button.textContent='Assemble approved picture lock';}
}

function readReferenceFile(file){
  return new Promise((resolve,reject)=>{
    if(!file) return reject(new Error('No file selected.'));
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)) return reject(new Error('Use a PNG, JPEG, or WebP reference.'));
    if(file.size>12*1024*1024) return reject(new Error('Reference image must be 12 MB or smaller.'));
    const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result||'')); reader.onerror=()=>reject(new Error('Reference image could not be read.')); reader.readAsDataURL(file);
  });
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
$('refreshRenderer').addEventListener('click',loadRendererStatus);
$('referenceImage').addEventListener('change',async event=>{
  try{
    referenceImageDataUrl=await readReferenceFile(event.currentTarget.files?.[0]);
    $('referenceStatus').textContent=`Reference loaded in browser memory · ${Math.round((event.currentTarget.files?.[0]?.size||0)/1024)} KB`;
    $('referenceStatus').className='sub';
    if(currentJob) renderJob(currentJob,{keepEvidence:true});
  }catch(error){referenceImageDataUrl=null;$('referenceStatus').textContent=error.message;$('referenceStatus').className='error';}
});

$('jobForm').addEventListener('submit',async event=>{
  event.preventDefault(); const button=$('generate'); button.disabled=true; button.textContent='Building production plan…'; $('formStatus').textContent=''; $('formStatus').className='sub';
  try{
    const body={workspace_id:$('workspaceId').value.trim(),mode:$('mode').value,visual_style:$('visualStyle').value,custom_style_prompt:$('customStylePrompt').value.trim(),quality:$('quality').value,aspect_ratio:$('aspectRatio').value};
    if(isLiveAction()){body.primary_subject=$('primarySubject').value.trim();body.product_or_world=$('productOrWorld').value.trim();body.viewer_takeaway=$('viewerTakeaway').value.trim();body.action_beats=actionBeatValues();}
    const job=await api('/api/video-engine/jobs',{method:'POST',body:JSON.stringify(body)});
    renderJob(job);
    $('formStatus').textContent=job.blueprint?.production_contract?.playable_video_required?'Production plan created. Validate it, then render real footage on the self-hosted lane.':'Deterministic preview plan created. Edit or validate it as-is.';
  }catch(error){$('formStatus').textContent=error.message;$('formStatus').className='error';}
  finally{button.disabled=false;button.textContent='Generate Production Plan';}
});

const params=new URLSearchParams(location.search); if(params.get('workspace_id')) $('workspaceId').value=params.get('workspace_id');
Promise.all([loadOptions(),loadRendererStatus()]).catch(error=>{$('formStatus').textContent=error.message;$('formStatus').className='error';});