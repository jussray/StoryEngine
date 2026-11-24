import { classifyHistory } from '../lib/renderGraphContract.js';

// Only accept the artifact emitted by the selected SaveVideo node.
export function selectSavedVideo(entry, nodeId) {
  const output = entry?.outputs?.[nodeId];
  const candidates = ['videos','animated','images'].flatMap(key =>
    Array.isArray(output?.[key]) ? output[key] : []);
  const videos = candidates.filter(item => item &&
    typeof item.filename === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}\.(mp4|webm|mov|mkv)$/i.test(item.filename) &&
    (item.type === undefined || item.type === 'output') &&
    (item.subfolder === undefined || (typeof item.subfolder === 'string' &&
      (item.subfolder === '' || item.subfolder.split('/').every(p=>/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p))))));
  if(videos.length>1) throw new Error('AMBIGUOUS_SAVEVIDEO_OUTPUT');
  return videos[0] || null;
}

export function completedVideo(entry,nodeId) {
  const early=classifyHistory(entry,true);
  if(early) throw new Error(early);
  const output=selectSavedVideo(entry,nodeId);
  const failure=classifyHistory(entry,Boolean(output));
  if(failure) throw new Error(failure);
  if(entry?.status?.completed===true && entry.status.status_str==='success') return output;
  return null;
}
