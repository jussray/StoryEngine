const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
let source = null;

function tick(){ $('clock').textContent = new Date().toLocaleTimeString(); }
tick(); setInterval(tick,1000);

async function api(path, options={}){
  const response = await fetch(path,{headers:{'Content-Type':'application/json'},...options});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||`Request failed: ${response.status}`);
  return data;
}

function statusClass(value){
  const text=String(value||'').toLowerCase();
  if(text.includes('block')||text.includes('error')||text.includes('fail')||text.includes('critical')) return 'red';
  if(text.includes('warn')||text.includes('watch')||text.includes('planned')||text.includes('queued')||text.includes('unknown')) return 'gold';
  return 'green';
}

function money(value){ return new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(Number(value||0)); }

function aggregateReleaseGate(workspaces){
  if(!Array.isArray(workspaces)||workspaces.length===0) return 'UNKNOWN';
  const statuses=workspaces.map(item=>String(item?.release_gate_status||'UNKNOWN').toUpperCase());
  if(statuses.includes('BLOCKED')) return 'BLOCKED';
  if(statuses.some(status=>!['READY','WARNING'].includes(status))) return 'UNKNOWN';
  if(statuses.includes('WARNING')) return 'WARNING';
  return 'READY';
}

function runtimeHealth(overview){
  const runs=Number(overview?.runtime_runs||0);
  if(runs<=0) return 'Unknown';
  if(Number(overview?.runtime_failures||0)>0) return 'Degraded';
  if(Number(overview?.running_dispatches||0)>0) return 'Running';
  return 'Healthy';
}

function renderStats(data){
  const memory=data.memory||{}; const overview=data.overview||{}; const workspaces=Array.isArray(data.workspaces)?data.workspaces:[];
  const confidence=memory.confidence_trend?.at(-1)?.confidence_after??workspaces[0]?.confidence_score??0;
  const gate=aggregateReleaseGate(workspaces);
  const runtime=runtimeHealth(overview);
  const cards=[
    ['Workspace Health',`${Math.round(confidence)}%`,confidence>=75?'green':'gold',`${overview.workspaces||0} workspaces`],
    ['Story Drift',memory.story_drift_count||0,memory.story_drift_count?'red':'teal','Unresolved genome conflicts'],
    ['Engine Drift',memory.engine_drift_count||0,memory.engine_drift_count?'purple':'green','Repeated mistakes today'],
    ['Runtime',runtime,statusClass(runtime),`${overview.queue_depth||0} queued`],
    ['Confidence',`${Math.round(confidence)}%`,'blue','Latest engine signal'],
    ['Lessons Today',memory.lessons_today||0,'gold',`${memory.repeated_mistake_count||0} repeated`],
    ['Release Gate',gate,statusClass(gate),`${overview.release_gate_blocked_count||0} blocked`],
    ['Operator Alerts',(data.operator_alerts||[]).length,(data.operator_alerts||[]).some(a=>a.severity==='critical')?'red':'green','Business and system guidance']
  ];
  $('stats').innerHTML=cards.map(([label,value,cls,sub])=>`<article class="card"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div><div class="sub">${esc(sub)}</div></article>`).join('');
}

function renderBrain(data){
  const brain=data.story_engine_brain||{};
  const current=brain.current;
  $('brainCount').textContent=`${brain.active_count||0} active run${Number(brain.active_count||0)===1?'':'s'}`;
  $('brainCurrent').textContent=current?`${current.active_agent} — ${current.current_stage}`:'Idle';
  $('brainWhy').textContent=current?`${current.request_text} · ${current.status}`:'Waiting for a Story Engine request.';
  $('brainOpen').href=current?`/story_engine.html?run_id=${encodeURIComponent(current.run_id)}`:'/story_engine.html';
  $('brainTrack').innerHTML=(brain.pipeline_stages||[]).map(stage=>`<div class="brain-node ${current?.current_stage===stage?'active':''}">${esc(stage.replaceAll('_',' '))}</div>`).join('');
}

function renderOperator(data){
  const summary=data.operator||{}; const profile=summary.profile||{};
  $('operatorName').value=profile.operator_name||'Operator';
  $('operatorMode').value=profile.mode||'bootstrap';
  $('monthlyBudget').value=Number(profile.monthly_budget||0);
  $('recurringBudget').value=Number(profile.recurring_budget||0);
  $('approvalThreshold').value=Number(profile.approval_threshold||0);
  $('cashAvailable').value=Number(profile.cash_available||0);
  $('monthlyRevenue').value=Number(profile.monthly_revenue||0);
  $('preferFree').checked=profile.prefer_free!==false;
  $('requireRecurringApproval').checked=profile.require_recurring_approval!==false;
  $('operatorNotes').value=profile.notes||'';
  $('operatorStatus').textContent=`${String(profile.mode||'bootstrap').toUpperCase()} · v${profile.version||1}`;
  const cards=[
    ['Revenue',money(summary.monthly_revenue),summary.monthly_revenue>0?'green':'gold'],
    ['Spend',money(summary.monthly_spend),summary.monthly_spend>summary.monthly_revenue?'red':'teal'],
    ['Profit',money(summary.monthly_profit),summary.monthly_profit>=0?'green':'red'],
    ['Burn',money(summary.burn_rate),summary.burn_rate>0?'gold':'green'],
    ['Budget Left',money(summary.budget_remaining),summary.budget_remaining>0?'blue':'gold'],
    ['Runway',summary.runway==null?'∞':`${summary.runway.toFixed(1)} mo`,summary.runway==null||summary.runway>=6?'green':'gold']
  ];
  $('operatorStats').innerHTML=cards.map(([label,value,cls])=>`<article class="card"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div></article>`).join('');
  $('operatorRecommendation').textContent=summary.recommendation||'Stay lean and ship.';
}

function renderAlerts(data){
  const alerts=data.operator_alerts||[];
  $('alertCount').textContent=`${alerts.length} active`;
  $('alerts').innerHTML=alerts.length?alerts.map(a=>`<div class="row alert ${esc(a.severity)}"><div class="row-title ${statusClass(a.severity)}">${esc(a.title)}</div><div class="row-meta">${esc(a.message)}</div>${a.action?`<div class="row-meta"><strong>Next:</strong> ${esc(a.action)}</div>`:''}<div class="row-meta">${esc(a.category)} · ${esc(a.severity)}</div></div>`).join(''):'<div class="empty">No operator alerts.</div>';
}

function incidentRows(data){
  const memory=(data.memory?.story_conflicts||[]).map(x=>({kind:'diff',id:x.id,title:`GENOME_DRIFT — ${x.entity_type}:${x.entity_id}`,meta:`${x.field}: ${x.old_value??'∅'} → ${x.new_value??'∅'}`,created_at:x.created_at}));
  const lindy=(data.incidents||[]).map(x=>({kind:'incident',id:x.incident_id,title:x.event_type||x.source||'Lindymode incident',meta:x.summary||x.reason||'',created_at:x.created_at}));
  return [...memory,...lindy].sort((a,b)=>Number(b.created_at||0)-Number(a.created_at||0));
}

function renderIncidents(data){
  const rows=incidentRows(data);
  $('incidents').innerHTML=rows.length?rows.map(item=>`<div class="row"><div class="row-title">${esc(item.title)}</div><div class="row-meta">${esc(item.meta)}${item.created_at?` · ${new Date(Number(item.created_at)).toLocaleString()}`:''}</div><div class="row-actions"><button class="btn resolve" data-kind="${item.kind}" data-id="${esc(item.id)}">Resolve</button></div></div>`).join(''):'<div class="empty">No active incidents.</div>';
  document.querySelectorAll('.resolve').forEach(button=>button.addEventListener('click',()=>{$('resolveType').value=button.dataset.kind;$('resolveId').value=button.dataset.id;$('resolution').value='';$('resolveDialog').showModal();}));
}

function renderPipeline(data){ $('pipeline').innerHTML=(data.pipeline_health||[]).map(x=>`<div class="row"><div class="row-title">${esc(x.label)}</div><div class="row-meta ${statusClass(x.status)}">${esc(x.status)}</div></div>`).join('')||'<div class="empty">No pipeline data.</div>'; }

function renderWorkspaces(data){
  $('workspaces').innerHTML=(data.workspaces||[]).map(item=>{const health=Math.max(0,Math.min(100,Number(item.confidence_score||0)));const attempt=item.latest_release_attempt;return `<tr><td><strong>${esc(item.title)}</strong></td><td><div class="bar"><div class="fill" style="width:${health}%"></div></div><span class="sub">${health}%</span></td><td>${item.chapter_count||0}</td><td class="${statusClass(item.release_gate_status)}">${esc(item.release_gate_status)}</td><td>${esc(item.runtime_status)}</td><td>${attempt?`${esc(attempt.operation)} · ${esc(attempt.status)}`:'—'}</td><td><a href="/story_home.html?workspace_id=${encodeURIComponent(item.workspace_id)}">Open</a></td></tr>`;}).join('')||'<tr><td colspan="7" class="empty">No workspaces.</td></tr>';
}

function renderLessons(data){
  const flat=(data.memory?.recent_lessons||[]).flatMap(row=>row.lessons.map(lesson=>({lesson,row})));
  $('lessons').innerHTML=flat.length?flat.map(({lesson,row})=>`<div class="row"><div class="row-title">${row.repeated_mistake?'↩ ':'✓ '}${esc(typeof lesson==='string'?lesson:JSON.stringify(lesson))}</div><div class="row-meta">${esc(row.workspace_id)} · ${new Date(Number(row.created_at)).toLocaleString()}</div></div>`).join(''):'<div class="empty">No lessons recorded today.</div>';
}

function renderConfidence(data){
  const trend=data.memory?.confidence_trend||[]; const values=trend.map(x=>Number(x.confidence_after??x.confidence_before??0)); const current=values.at(-1)??0;
  $('confidenceSummary').textContent=trend.length?`Current ${Math.round(current)}% · ${trend.length} recent episodes`:'No confidence history yet.';
  $('confidenceChart').innerHTML=values.length?values.map(v=>`<div class="chart-bar" title="${v}%" style="height:${Math.max(4,Math.min(100,v))}%"></div>`).join(''):'<div class="empty">No trend data.</div>';
}

function render(data){
  renderStats(data); renderBrain(data); renderOperator(data); renderAlerts(data); renderIncidents(data); renderPipeline(data); renderWorkspaces(data); renderLessons(data); renderConfidence(data);
  $('updated').textContent=`Updated ${new Date(data.control_room_generated_at||data.generated_at).toLocaleString()}`;
}

async function load(){
  try{const data=await api('/api/control-room/overview');render(data);$('liveState').textContent='Live';$('liveState').className='pill green';}
  catch(error){$('liveState').textContent=error.message;$('liveState').className='pill red';}
}

function connectStream(){
  source?.close(); source=new EventSource('/api/control-room/stream');
  source.addEventListener('snapshot',event=>{render(JSON.parse(event.data));$('liveState').textContent='Live';$('liveState').className='pill green';});
  source.addEventListener('error',()=>{$('liveState').textContent='Reconnecting…';$('liveState').className='pill gold';});
}

$('refresh').addEventListener('click',load);
$('operatorForm').addEventListener('submit',async event=>{
  event.preventDefault(); $('operatorStatus').textContent='Saving…';
  try{
    await api('/api/control-room/operator',{method:'PUT',body:JSON.stringify({
      operator_name:$('operatorName').value,mode:$('operatorMode').value,
      monthly_budget:Number($('monthlyBudget').value||0),recurring_budget:Number($('recurringBudget').value||0),
      approval_threshold:Number($('approvalThreshold').value||0),cash_available:Number($('cashAvailable').value||0),
      monthly_revenue:Number($('monthlyRevenue').value||0),prefer_free:$('preferFree').checked,
      require_recurring_approval:$('requireRecurringApproval').checked,notes:$('operatorNotes').value
    })});
    await load(); $('operatorStatus').textContent='Saved';
  }catch(error){$('operatorStatus').textContent=error.message;}
});

$('confirmResolve').addEventListener('click',async event=>{
  event.preventDefault(); const kind=$('resolveType').value; const id=$('resolveId').value; const resolution=$('resolution').value.trim(); if(!resolution)return;
  const body=kind==='diff'?{diff_id:Number(id),resolution}:{incident_id:id,resolution};
  try{await api('/api/control-room/resolve-incident',{method:'POST',body:JSON.stringify(body)});$('resolveDialog').close();await load();}catch(error){alert(error.message);}
});

load(); connectStream();
