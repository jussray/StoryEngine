import { createHash } from 'node:crypto';

const fail = message => { throw Object.assign(new Error(message), {code:'OPEN_RENDER_GRAPH_INVALID'}); };
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])) : value;
export const graphDigest = value => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');

export function framePlan(seconds,fps) {
  if (!Number.isFinite(seconds)||seconds<1||seconds>15||!Number.isInteger(fps)||fps<8||fps>60) fail('Shot duration or frame rate outside supported bounds.');
  const deliveryFrames=Math.ceil(seconds*fps);
  const modelFrames=Math.max(17,Math.ceil((deliveryFrames-1)/4)*4+1);
  return {deliveryFrames,modelFrames,fps};
}

export function validateCompiledGraph(graph,info,{requiredTypes=[],referenceName,maxPixelFrames=832*480*361}={}) {
  if (!graph||typeof graph!=='object'||Array.isArray(graph)||!info||typeof info!=='object') fail('Graph or worker node schema missing.');
  const entries=Object.entries(graph);
  if (!entries.length||entries.length>256) fail('Graph size outside bounds.');
  const types=new Set(entries.map(([,n])=>n?.class_type));
  for(const type of requiredTypes) if(!types.has(type)) fail('Required graph node absent: '+type);
  const seen=new Set(), active=new Set();
  function visit(id) {
    if(active.has(id)) fail('Graph cycle.');
    if(seen.has(id)) return;
    active.add(id);
    const node=graph[id];
    const schema=Object.hasOwn(info,node?.class_type) ? info[node.class_type] : null;
    if(!schema||!node.inputs||typeof node.inputs!=='object'||Array.isArray(node.inputs)) fail('Unknown node or invalid inputs: '+id);
    const required=schema.input?.required||{};
    const optional=schema.input?.optional||{};
    for(const key of Object.keys(required)) if(!Object.hasOwn(node.inputs,key)) fail('Missing required input: '+id+'.'+key);
    for(const [key,v] of Object.entries(node.inputs)) {
      const contract=required[key]||optional[key];
      if(Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isInteger(v[1])) {
        const target=Object.hasOwn(graph,v[0])?graph[v[0]]:null;
        const output=target&&Object.hasOwn(info,target.class_type)?info[target.class_type]?.output:null;
        if(!target||!Array.isArray(output)||v[1]<0||v[1]>=output.length) fail('Broken graph edge: '+id+'.'+key);
        const want=contract?.[0], actual=output[v[1]];
        if(typeof want==='string'&&typeof actual==='string'&&want!=='*'&&actual!=='*'&&!want.split(',').includes(actual)) fail('Incompatible graph edge: '+id+'.'+key);
        visit(v[0]);
      } else if(Array.isArray(contract?.[0])&&!contract[0].includes(v)) {
        fail('Worker does not advertise selected input: '+id+'.'+key);
      }
      if(typeof v==='number'&&(!Number.isFinite(v)||(typeof contract?.[1]?.min==='number'&&v<contract[1].min)||(typeof contract?.[1]?.max==='number'&&v>contract[1].max))) fail('Input outside worker bounds: '+id+'.'+key);
    }
    if(node.class_type==='LoadImage'&&referenceName!==undefined&&node.inputs.image!==referenceName) fail('Reference image mismatch.');
    if(node.class_type==='Wan22ImageToVideoLatent') {
      const {width,height,length,batch_size}=node.inputs;
      if(![width,height,length,batch_size].every(Number.isSafeInteger)||width<256||height<144||width>1920||height>1920||length<17||(length-1)%4!==0||batch_size!==1||width*height*length>maxPixelFrames) fail('Latent dimensions or frame budget outside configured envelope.');
    }
    active.delete(id);seen.add(id);
  }
  for(const [id] of entries) visit(id);
  if(!entries.some(([,n])=>info[n.class_type]?.output_node===true)) fail('Graph has no advertised output node.');
  // Asset choice lists are dynamic; pin their contract shape, not tenant filenames.
  const contractShape = type => {
    const schema=info[type];
    const inputs=Object.fromEntries(['required','optional'].map(group=>[group,
      Object.fromEntries(Object.entries(schema.input?.[group]||{}).map(([key,value])=>
        [key,Array.isArray(value?.[0])?['ENUM',...value.slice(1)]:value]))]));
    return {input:inputs,output:schema.output,output_node:schema.output_node===true};
  };
  return {nodes:entries.length,compiled_sha256:graphDigest(graph),node_contract_sha256:graphDigest(Object.fromEntries([...types].sort().map(t=>[t,contractShape(t)])))};
}

export function parseFrameRate(rate) {
  if (typeof rate !== 'number' && typeof rate !== 'string') return NaN;
  const parts = String(rate).trim().split('/').map(part => part.trim());
  if (parts.length > 2 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return NaN;
  const numerator = Number(parts[0]), denominator = parts.length === 2 ? Number(parts[1]) : 1;
  const fps = numerator / denominator;
  return Number.isFinite(fps) && numerator > 0 && denominator > 0 ? fps : NaN;
}

export function classifyHistory(entry,hasOutput) {
  const messages=Array.isArray(entry?.status?.messages)?entry.status.messages:[];
  const normalized=messages.map(m=>Array.isArray(m)?{kind:m[0],payload:m[1]}:{kind:m?.type,payload:m?.data??m?.payload??m});
  if(normalized.some(m=>m.kind==='execution_interrupted')) return 'OPEN_RENDER_INTERRUPTED';
  const errors=normalized.filter(m=>m.kind==='execution_error');
  if(errors.some(m=>/outofmemory|out of memory|cuda oom/i.test(String(m.payload?.exception_type||'')+' '+String(m.payload?.exception_message||'')))) return 'OPEN_RENDER_GPU_OOM';
  if(errors.length||entry?.status?.status_str==='error'||(entry?.status?.completed===true&&entry.status.status_str!=='success')) return 'OPEN_RENDER_EXECUTION_FAILED';
  if(entry?.status?.completed===true&&!hasOutput) return 'OPEN_RENDER_OUTPUT_MISSING';
  return null;
}

export function repairSelection(shots,maxRepairs=2) {
  if(!Number.isInteger(maxRepairs)||maxRepairs<0||maxRepairs>3) fail('Repair budget outside bounds.');
  const retry=[],blocked=[],ids=new Set();
  for(const shot of shots) {
    if(typeof shot.id!=='string'||!shot.id||ids.has(shot.id)||typeof shot.passed!=='boolean') fail('Invalid shot review state.');
    ids.add(shot.id);
    if(shot.passed) continue;
    if(!Number.isInteger(shot.attempt)||shot.attempt<0) fail('Invalid repair attempt.');
    (shot.attempt<maxRepairs?retry:blocked).push(shot.id);
  }
  return {retry,blocked};
}
