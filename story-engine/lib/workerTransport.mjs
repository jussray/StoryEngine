const failure=(code,message,status)=>Object.assign(new Error(message),{code,...(status===undefined?{}:{status})});

// Bound the entire request, including the streamed response body.
export async function fetchBoundedBytes(url,init={}, {timeoutMs,maxBytes,fetchImpl=fetch}={}) {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(maxBytes)||maxBytes<1) throw new TypeError('Invalid renderer transport bounds.');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let reader;
  try {
    const response=await fetchImpl(url,{...init,redirect:'error',signal:controller.signal});
    if(!response.ok) {
      response.body?.cancel().catch(()=>{});
      throw failure(`COMFYUI_HTTP_${response.status}`,`ComfyUI request failed with HTTP ${response.status}.`,response.status);
    }
    const declared=Number(response.headers.get('content-length')||0);
    if(declared>maxBytes) {
      response.body?.cancel().catch(()=>{});
      throw failure('OPEN_RENDER_RESPONSE_TOO_LARGE','Renderer response exceeded the configured size limit.');
    }
    if(!response.body) return Buffer.alloc(0);
    reader=response.body.getReader();
    const chunks=[];let size=0;
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes)throw failure('OPEN_RENDER_RESPONSE_TOO_LARGE','Renderer response exceeded the configured size limit.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks,size);
  } catch(error) {
    if(controller.signal.aborted) throw failure('OPEN_RENDER_COMPUTE_TIMEOUT','ComfyUI request timed out.');
    if(error?.code)throw error;
    throw failure('OPEN_RENDER_COMPUTE_UNREACHABLE','ComfyUI request failed.');
  } finally {
    if(reader){reader.cancel().catch(()=>{});reader.releaseLock();}
    clearTimeout(timer);
  }
}
